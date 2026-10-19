import type { FastifyInstance, FastifyReply } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import {
  audit,
  csrf,
  requireAdmin,
  sendMail,
  setSessionCookie,
  totp,
} from "./auth.js";
import {
  adminBindingInput,
  keepEffectiveSuper,
  lockAdminAccess,
  permit,
  requireRecentMfa,
  revokeAdminSessions,
  validateAdminDelegation,
} from "./admin-access.js";
import { key, replay } from "./access.js";
import {
  email,
  equal,
  hash,
  hmac,
  name,
  Problem,
  seal,
  token,
  unseal,
  uuid,
} from "./lib.js";
import * as OTPAuth from "otpauth";
import { z } from "zod";

const reason = z.string().trim().min(3).max(2000);
const expectedVersion = z.number().int().positive();
const capability = z.string().regex(/^[\w-]{43}$/);
const challengeInput = z.object({
  challenge_id: uuid,
  code: z.string().regex(/^\d{6}$/),
});
const principalFields =
  "id,email,name,status,enrollment_state,enrolled_at,version,created_at";
const invalid = () =>
  new Problem(
    401,
    "ENROLLMENT_INVALID",
    "This verification or invitation is invalid, expired or already used",
  );

async function publicPrincipal(tx: Tx, id: string) {
  const p = (
    await tx.query(
      `SELECT ${principalFields} FROM admin_principals WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!p) throw new Problem(404, "NOT_FOUND", "Administrator not found");
  p.invitation =
    (
      await tx.query(
        "SELECT id,purpose,delivery_state,delivery_error,delivered_at,expires_at,consumed_at,revoked_at,created_at FROM admin_enrollments WHERE principal_id=$1 AND purpose<>'self_rotate' ORDER BY created_at DESC,id DESC LIMIT 1",
        [id],
      )
    ).rows[0] ?? null;
  return p;
}
async function targetPrincipal(tx: Tx, id: string, version?: number) {
  const p = (
    await tx.query("SELECT * FROM admin_principals WHERE id=$1 FOR UPDATE", [
      id,
    ])
  ).rows[0];
  if (!p) throw new Problem(404, "NOT_FOUND", "Administrator not found");
  if (version !== undefined && version !== p.version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Refresh the administrator before making this change",
    );
  return p;
}
async function revokeSetups(tx: Tx, id: string) {
  await tx.query(
    "UPDATE admin_enrollments SET revoked_at=now(),token_ciphertext=NULL,setup_secret=NULL WHERE principal_id=$1 AND revoked_at IS NULL AND consumed_at IS NULL",
    [id],
  );
}
async function prepareInvitation(
  tx: Tx,
  db: Database,
  p: any,
  actor: Principal,
  purpose: "initial" | "reset",
) {
  await revokeSetups(tx, p.id);
  const value = token();
  return (
    await tx.query(
      "INSERT INTO admin_enrollments(principal_id,purpose,created_by,issued_auth_version,token_hash,token_ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') RETURNING id,expires_at,delivery_state",
      [
        p.id,
        purpose,
        actor.id,
        p.auth_version,
        hash(value),
        seal(db.config.MASTER_KEY!, value),
      ],
    )
  ).rows[0];
}
async function deliverInvitation(db: Database, id: string) {
  return db.tx(
    async (tx) => {
      const e = (
        await tx.query(
          "SELECT e.*,p.email,p.status,p.enrollment_state,p.auth_version AS current_auth_version,e.expires_at>now() AS valid FROM admin_enrollments e JOIN admin_principals p ON p.id=e.principal_id WHERE e.id=$1 FOR UPDATE OF e",
          [id],
        )
      ).rows[0];
      if (
        !e ||
        !e.valid ||
        e.consumed_at ||
        e.revoked_at ||
        e.status !== "active" ||
        e.enrollment_state !== "pending" ||
        e.current_auth_version !== e.issued_auth_version
      )
        return "unavailable";
      if (e.delivery_state === "sent") return "sent";
      if (!e.token_ciphertext) return "unavailable";
      const link = new URL("/enroll", db.config.ADMIN_ORIGIN);
      link.hash = "token=" + unseal(db.config.MASTER_KEY!, e.token_ciphertext);
      try {
        await sendMail(
          db,
          e.email,
          "CopyPaste · 管理員開通 / Administrator setup",
          `An authorized operator invited you to set up your CopyPaste administrator account.\n\n${link.href}\n\nThis single-use invitation expires in 24 hours. Verify your email and set up your own authenticator. It does not disclose your authentication keys to the inviting operator. If unexpected, contact your platform administrator.`,
          e.id,
        );
        await tx.query(
          "UPDATE admin_enrollments SET delivery_state='sent',delivery_error=NULL,delivered_at=now(),token_ciphertext=NULL WHERE id=$1",
          [e.id],
        );
        return "sent";
      } catch {
        await tx.query(
          "UPDATE admin_enrollments SET delivery_state='failed',delivery_error='MAIL_UNAVAILABLE' WHERE id=$1",
          [e.id],
        );
        return "failed";
      }
    },
    undefined,
    true,
  );
}
async function invitation(tx: Tx, value: string, lock = false) {
  const e = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM admin_enrollments WHERE token_hash=$1" +
        (lock ? " FOR UPDATE" : ""),
      [hash(value)],
    )
  ).rows[0];
  if (
    !e ||
    e.purpose === "self_rotate" ||
    !e.valid ||
    e.revoked_at ||
    e.consumed_at
  )
    throw invalid();
  const p = lock
    ? await targetPrincipal(tx, e.principal_id)
    : (
        await tx.query("SELECT * FROM admin_principals WHERE id=$1", [
          e.principal_id,
        ])
      ).rows[0];
  if (
    p.status !== "active" ||
    p.enrollment_state !== "pending" ||
    p.auth_version !== e.issued_auth_version
  )
    throw invalid();
  return { e, p };
}
async function verifyEmailChallenge(
  tx: Tx,
  db: Database,
  b: z.infer<typeof challengeInput>,
) {
  const c = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM auth_challenges WHERE id=$1 AND audience='admin' FOR UPDATE",
      [b.challenge_id],
    )
  ).rows[0];
  if (!c || !c.valid || c.consumed_at || c.attempts >= 5) return null;
  await tx.query("UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1", [
    c.id,
  ]);
  return equal(
    c.digest,
    hmac(db.config.MASTER_KEY!, `admin:${c.email}:${b.code}`),
  )
    ? c
    : null;
}
async function setupSecret(tx: Tx, db: Database, e: any, p: any) {
  const value = token(),
    secret = new OTPAuth.Secret({ size: 20 });
  const result = (
    await tx.query(
      "UPDATE admin_enrollments SET setup_hash=$2,setup_secret=$3,setup_expires_at=least(expires_at,now()+interval '10 minutes'),setup_attempts=0,email_verified_at=now() WHERE id=$1 RETURNING setup_expires_at",
      [e.id, hash(value), seal(db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  const auth = totp(secret.base32);
  auth.label = p.email;
  await audit(
    tx,
    { id: p.id, audience: "admin" },
    "auth.admin.enrollment.email_verified",
    e.id,
  );
  // This is the only response containing a new authenticator key. No replay
  // cache or administrator resource projection stores this response.
  return {
    setup_token: value,
    setup_key: secret.base32,
    otpauth_uri: auth.toString(),
    email: p.email,
    expires_at: result.setup_expires_at,
  };
}
async function adminSession(tx: Tx, db: Database, p: any) {
  const value = token();
  await tx.query(
    "INSERT INTO sessions(token_hash,admin_id,audience,auth_version,expires_at,mfa_at) VALUES($1,$2,'admin',$3,now()+interval '8 hours',now())",
    [hash(value), p.id, p.auth_version],
  );
  return {
    value,
    user: { id: p.id, name: p.name, email: p.email },
    csrf_token: csrf(db, value),
  };
}
async function finishSetup(
  db: Database,
  reply: FastifyReply,
  b: { setup_token: string; totp: string },
  actor?: Principal,
) {
  const result = await db.tx(
    async (tx) => {
      await lockAdminAccess(tx);
      if (actor) await requireRecentMfa(tx, actor);
      const e = (
        await tx.query(
          "SELECT *,expires_at>now() AND setup_expires_at>now() AS valid FROM admin_enrollments WHERE setup_hash=$1 FOR UPDATE",
          [hash(b.setup_token)],
        )
      ).rows[0];
      if (
        !e ||
        !e.valid ||
        e.revoked_at ||
        e.consumed_at ||
        !e.email_verified_at ||
        !e.setup_secret ||
        e.setup_attempts >= 5
      )
        return { error: true } as const;
      const p = await targetPrincipal(tx, e.principal_id);
      const rotating = e.purpose === "self_rotate";
      if (
        p.status !== "active" ||
        p.auth_version !== e.issued_auth_version ||
        (rotating
          ? p.enrollment_state !== "enrolled" ||
            actor?.id !== p.id ||
            actor?.sessionId !== e.initiated_session_id
          : p.enrollment_state !== "pending" || !!actor)
      )
        return { error: true } as const;
      await tx.query(
        "UPDATE admin_enrollments SET setup_attempts=setup_attempts+1 WHERE id=$1",
        [e.id],
      );
      const verifier = totp(unseal(db.config.MASTER_KEY!, e.setup_secret));
      const delta = verifier.validate({ token: b.totp, window: 1 });
      if (delta === null) return { error: true } as const;
      const step = Math.floor(Date.now() / 30000) + delta;
      await tx.query(
        "UPDATE admin_principals SET totp_secret=$2,enrollment_state='enrolled',enrolled_at=now(),last_totp_step=$3 WHERE id=$1",
        [p.id, e.setup_secret, step],
      );
      await revokeAdminSessions(tx, p.id);
      await tx.query(
        "UPDATE admin_enrollments SET consumed_at=now(),setup_secret=NULL,token_ciphertext=NULL WHERE id=$1",
        [e.id],
      );
      await keepEffectiveSuper(tx);
      const current = await targetPrincipal(tx, p.id);
      await audit(
        tx,
        { id: p.id, audience: "admin" },
        rotating ? "auth.admin.mfa.rotated" : "auth.admin.enrollment.completed",
        e.id,
        "succeeded",
        { purpose: e.purpose },
      );
      return adminSession(tx, db, current);
    },
    undefined,
    true,
  );
  if ("error" in result) throw invalid();
  setSessionCookie(db, reply, result.value, true);
  return { user: result.user, csrf_token: result.csrf_token };
}

export function registerAdminIdentities(app: FastifyInstance, db: Database) {
  const base = "/v1/admin/access/principals";
  app.get(base, { preHandler: requireAdmin(db) }, async (req) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        page_size: z.coerce.number().int().min(1).max(100).default(50),
        search: z.string().max(160).default(""),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        await permit(tx, req.principal, "admin.access.read");
        const search = "%" + q.search + "%";
        const total = (
          await tx.query(
            "SELECT count(*)::int AS n FROM admin_principals WHERE name ILIKE $1 OR email ILIKE $1",
            [search],
          )
        ).rows[0].n;
        const items = (
          await tx.query(
            `SELECT ${principalFields} FROM admin_principals WHERE name ILIKE $1 OR email ILIKE $1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,
            [search, q.page_size, (q.page - 1) * q.page_size],
          )
        ).rows;
        await audit(tx, req.principal, "admin.access.read", undefined);
        return { items, total, page: q.page, page_size: q.page_size };
      },
      undefined,
      true,
    );
  });
  app.get(base + "/:id", { preHandler: requireAdmin(db) }, async (req) =>
    db.tx(
      async (tx) => {
        await permit(tx, req.principal, "admin.access.read");
        const id = uuid.parse((req.params as any).id),
          p = await publicPrincipal(tx, id);
        const bindings = (
          await tx.query(
            "SELECT b.*,r.name AS role_name,r.permissions FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key WHERE principal_id=$1 ORDER BY b.created_at DESC,b.id",
            [id],
          )
        ).rows;
        const sessions = (
          await tx.query(
            "SELECT id,audience,created_at,expires_at,mfa_at,revoked_at,(revoked_at IS NULL AND expires_at>now() AND auth_version=(SELECT auth_version FROM admin_principals WHERE id=$1)) AS active FROM sessions WHERE admin_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101",
            [id],
          )
        ).rows;
        await audit(tx, req.principal, "admin.access.read", id);
        return {
          principal: p,
          bindings,
          sessions: sessions.slice(0, 100),
          sessions_truncated: sessions.length > 100,
          current_session_id:
            req.principal.id === id ? req.principal.sessionId : null,
        };
      },
      undefined,
      true,
    ),
  );
  app.post(base, { preHandler: requireAdmin(db) }, async (req) => {
    const b = z
      .object({ email, name, reason, binding: adminBindingInput.optional() })
      .strict()
      .parse(req.body);
    const result = await db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        await permit(tx, req.principal, "admin.access.principals.write");
        await requireRecentMfa(tx, req.principal);
        if (b.email === req.principal.email)
          throw new Problem(
            403,
            "SELF_BINDING_FORBIDDEN",
            "You cannot invite or reassign your own identity",
          );
        return replay(
          tx,
          req.principal.id,
          "admin.principal.invite",
          key(req),
          b,
          async () => {
            if (b.binding)
              await validateAdminDelegation(tx, req.principal, b.binding);
            const p = (
              await tx.query(
                "INSERT INTO admin_principals(email,name,totp_secret,enrollment_state) VALUES($1,$2,NULL,'pending') RETURNING *",
                [b.email, b.name],
              )
            ).rows[0];
            if (b.binding) {
              const g = b.binding;
              await tx.query(
                "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect,limits,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
                [
                  p.id,
                  g.role_key,
                  g.scope_kind,
                  g.scope_id ?? null,
                  g.effect,
                  g.limits,
                  g.expires_at ?? null,
                ],
              );
              await revokeAdminSessions(tx, p.id);
            }
            const current = await targetPrincipal(tx, p.id),
              e = await prepareInvitation(
                tx,
                db,
                current,
                req.principal,
                "initial",
              );
            await audit(
              tx,
              req.principal,
              "admin.access.principals.write",
              p.id,
              "succeeded",
              {
                action: "invite",
                reason: b.reason,
                initial_role: b.binding?.role_key ?? null,
              },
            );
            return {
              principal: await publicPrincipal(tx, p.id),
              invitation_id: e.id,
            };
          },
        );
      },
      undefined,
      true,
    );
    return {
      ...result,
      delivery: await deliverInvitation(db, result.invitation_id),
    };
  });
  app.patch(base + "/:id", { preHandler: requireAdmin(db) }, async (req) => {
    const id = uuid.parse((req.params as any).id),
      b = z
        .object({ expected_version: expectedVersion, name, reason })
        .strict()
        .parse(req.body);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        await permit(tx, req.principal, "admin.access.principals.write");
        await requireRecentMfa(tx, req.principal);
        return replay(
          tx,
          req.principal.id,
          `admin.principal.profile:${id}`,
          key(req),
          b,
          async () => {
            await targetPrincipal(tx, id, b.expected_version);
            await tx.query(
              "UPDATE admin_principals SET name=$2,version=version+1 WHERE id=$1",
              [id, b.name],
            );
            await audit(
              tx,
              req.principal,
              "admin.access.principals.write",
              id,
              "succeeded",
              { action: "profile", reason: b.reason },
            );
            return publicPrincipal(tx, id);
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post(
    base + "/:id/status",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = z
          .object({
            expected_version: expectedVersion,
            state: z.enum(["active", "suspended"]),
            reason,
          })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await permit(tx, req.principal, "admin.access.principals.write");
          await requireRecentMfa(tx, req.principal);
          if (id === req.principal.id)
            throw new Problem(
              403,
              "SELF_STATE_FORBIDDEN",
              "Another authorized administrator must change your account status",
            );
          return replay(
            tx,
            req.principal.id,
            `admin.principal.status:${id}`,
            key(req),
            b,
            async () => {
              await targetPrincipal(tx, id, b.expected_version);
              await tx.query(
                "UPDATE admin_principals SET status=$2 WHERE id=$1",
                [id, b.state],
              );
              await revokeAdminSessions(tx, id);
              await revokeSetups(tx, id);
              await keepEffectiveSuper(tx);
              await audit(
                tx,
                req.principal,
                "admin.access.principals.write",
                id,
                "succeeded",
                { action: "status", state: b.state, reason: b.reason },
              );
              return publicPrincipal(tx, id);
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  for (const action of ["enrollment", "reset-mfa"] as const)
    app.post(
      base + "/:id/" + action,
      { preHandler: requireAdmin(db) },
      async (req) => {
        const id = uuid.parse((req.params as any).id),
          b = z
            .object({ expected_version: expectedVersion, reason })
            .strict()
            .parse(req.body);
        const result = await db.tx(
          async (tx) => {
            await lockAdminAccess(tx);
            await permit(tx, req.principal, "admin.access.principals.write");
            await requireRecentMfa(tx, req.principal);
            if (id === req.principal.id)
              throw new Problem(
                403,
                "SELF_RESET_FORBIDDEN",
                "Use your own authenticator settings to replace MFA",
              );
            return replay(
              tx,
              req.principal.id,
              `admin.principal.${action}:${id}`,
              key(req),
              b,
              async () => {
                const p = await targetPrincipal(tx, id, b.expected_version);
                if (p.status !== "active")
                  throw new Problem(
                    409,
                    "ADMIN_SUSPENDED",
                    "Resume this account before inviting it",
                  );
                if (
                  (action === "enrollment" &&
                    p.enrollment_state !== "pending") ||
                  (action === "reset-mfa" && p.enrollment_state !== "enrolled")
                )
                  throw new Problem(
                    409,
                    "ENROLLMENT_STATE_CHANGED",
                    "Refresh the current MFA state before continuing",
                  );
                if (action === "reset-mfa")
                  await tx.query(
                    "UPDATE admin_principals SET enrollment_state='pending',totp_secret=NULL,enrolled_at=NULL,last_totp_step=-1 WHERE id=$1",
                    [id],
                  );
                await revokeAdminSessions(tx, id);
                await keepEffectiveSuper(tx);
                const current = await targetPrincipal(tx, id),
                  e = await prepareInvitation(
                    tx,
                    db,
                    current,
                    req.principal,
                    action === "enrollment" ? "initial" : "reset",
                  );
                await audit(
                  tx,
                  req.principal,
                  "admin.access.principals.write",
                  id,
                  "succeeded",
                  { action, reason: b.reason },
                );
                return {
                  principal: await publicPrincipal(tx, id),
                  invitation_id: e.id,
                };
              },
            );
          },
          undefined,
          true,
        );
        return {
          ...result,
          delivery: await deliverInvitation(db, result.invitation_id),
        };
      },
    );
  for (const action of ["session-revocations", "revoke-sessions"])
    app.post(
      base + "/:id/" + action,
      { preHandler: requireAdmin(db) },
      async (req) => {
        const id = uuid.parse((req.params as any).id),
          b = z
            .object({ expected_version: expectedVersion, reason })
            .strict()
            .parse(req.body);
        return db.tx(
          async (tx) => {
            await lockAdminAccess(tx);
            await permit(tx, req.principal, "admin.access.sessions.revoke");
            await requireRecentMfa(tx, req.principal);
            return replay(
              tx,
              req.principal.id,
              `admin.principal.revoke_sessions:${id}`,
              key(req),
              b,
              async () => {
                await targetPrincipal(tx, id, b.expected_version);
                await revokeAdminSessions(tx, id);
                await revokeSetups(tx, id);
                await audit(
                  tx,
                  req.principal,
                  "admin.access.sessions.revoke",
                  id,
                  "succeeded",
                  { reason: b.reason },
                );
                return publicPrincipal(tx, id);
              },
            );
          },
          undefined,
          true,
        );
      },
    );
  app.post("/v1/admin/auth/enrollment/inspect", async (req) => {
    const b = z.object({ token: capability }).strict().parse(req.body);
    return db.tx(
      async (tx) => {
        const { e, p } = await invitation(tx, b.token);
        return {
          email: p.email,
          name: p.name,
          purpose: e.purpose,
          expires_at: e.expires_at,
        };
      },
      undefined,
      true,
    );
  });
  app.post("/v1/admin/auth/enrollment/setup", async (req) => {
    const b = challengeInput
      .extend({ token: capability })
      .strict()
      .parse(req.body);
    const result = await db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const c = await verifyEmailChallenge(tx, db, b);
        if (!c) return { error: true } as const;
        let match;
        try {
          match = await invitation(tx, b.token, true);
        } catch (error) {
          if (error instanceof Problem && error.code === "ENROLLMENT_INVALID")
            return { error: true } as const;
          throw error;
        }
        if (c.email !== match.p.email) return { error: true } as const;
        await tx.query(
          "UPDATE auth_challenges SET consumed_at=now() WHERE id=$1",
          [c.id],
        );
        return setupSecret(tx, db, match.e, match.p);
      },
      undefined,
      true,
    );
    if ("error" in result) throw invalid();
    return result;
  });
  const completion = z
    .object({ setup_token: capability, totp: z.string().regex(/^\d{6}$/) })
    .strict();
  app.post("/v1/admin/auth/enrollment/complete", async (req, reply) =>
    finishSetup(db, reply, completion.parse(req.body)),
  );
  app.post(
    "/v1/admin/auth/mfa/setup",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = challengeInput.strict().parse(req.body);
      const result = await db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireRecentMfa(tx, req.principal);
          const c = await verifyEmailChallenge(tx, db, b);
          if (!c || c.email !== req.principal.email)
            return { error: true } as const;
          const p = await targetPrincipal(tx, req.principal.id);
          if (
            p.status !== "active" ||
            p.enrollment_state !== "enrolled" ||
            p.auth_version !== req.principal.authVersion
          )
            return { error: true } as const;
          await tx.query(
            "UPDATE auth_challenges SET consumed_at=now() WHERE id=$1",
            [c.id],
          );
          await revokeSetups(tx, p.id);
          const e = (
            await tx.query(
              "INSERT INTO admin_enrollments(principal_id,purpose,created_by,issued_auth_version,token_hash,initiated_session_id,delivery_state,expires_at) VALUES($1,'self_rotate',$1,$2,$3,$4,'not_required',now()+interval '10 minutes') RETURNING *",
              [p.id, p.auth_version, hash(token()), req.principal.sessionId],
            )
          ).rows[0];
          return setupSecret(tx, db, e, p);
        },
        undefined,
        true,
      );
      if ("error" in result) throw invalid();
      return result;
    },
  );
  app.post(
    "/v1/admin/auth/mfa/complete",
    { preHandler: requireAdmin(db) },
    async (req, reply) =>
      finishSetup(db, reply, completion.parse(req.body), req.principal),
  );
}
