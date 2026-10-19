import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Database, Tx } from "./db.js";
import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import * as OTPAuth from "otpauth";
import { z } from "zod";
import { validFederation } from "./federation-session.js";
import {
  authRequest,
  authRequestKey,
  deliverAuthChallenge,
} from "./auth-receipts.js";
import {
  email,
  equal,
  hash,
  hmac,
  name,
  Problem,
  token,
  unseal,
  uuid,
} from "./lib.js";

export interface Principal {
  id: string;
  email: string;
  name: string;
  audience: "user" | "admin" | "native";
  sessionId: string;
  sessionHash: string;
  authVersion: number;
  mfaAt?: Date;
}
declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}
export async function audit(
  tx: Tx,
  p: Partial<Principal> | undefined,
  action: string,
  target: string | undefined,
  outcome = "succeeded",
  detail: unknown = {},
  tenant?: string,
) {
  await tx.query(
    "INSERT INTO audit_log(principal_id,actor_kind,action,tenant_id,target,outcome,detail) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      p?.id ?? null,
      p?.audience ?? "system",
      action,
      tenant ?? null,
      target ?? null,
      outcome,
      detail,
    ],
  );
}
export function csrf(db: Database, value: string) {
  return hmac(db.config.MASTER_KEY!, `csrf:${value}`);
}
export async function principal(
  db: Database,
  req: FastifyRequest,
  audience: "user" | "admin" = "user",
): Promise<Principal> {
  const bearer = req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
  const cookie =
    req.cookies[audience === "admin" ? "cp_admin_session" : "cp_session"];
  const value = bearer ?? cookie;
  if (!value)
    throw new Problem(401, "AUTH_REQUIRED", "請先登入 / Please sign in");
  // A bearer credential is native-only; browser cookies never authenticate the other audience.
  if (audience === "admin" && bearer)
    throw new Problem(401, "AUTH_REQUIRED", "Admin browser session required");
  const pool = audience === "admin" ? db.control : db.app;
  const { rows } = await pool.query(
    `SELECT s.*, p.email,p.name,p.status,${audience === "admin" ? "p.enrollment_state," : ""}p.auth_version AS current_version
    FROM sessions s JOIN ${audience === "admin" ? "admin_principals" : "users"} p ON p.id=s.${audience === "admin" ? "admin_id" : "user_id"}
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
    [hash(value)],
  );
  const s = rows[0];
  if (
    !s ||
    s.status !== "active" ||
    s.auth_version !== s.current_version ||
    (audience === "admin"
      ? s.audience !== "admin" || s.enrollment_state !== "enrolled"
      : s.audience !== (bearer ? "native" : "user")) ||
    (audience !== "admin" && !(await validFederation(pool, s)))
  )
    throw new Problem(
      401,
      "SESSION_EXPIRED",
      "登入已失效，請重新登入 / Session expired",
    );
  if (!bearer && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const supplied = req.headers["x-csrf-token"];
    if (typeof supplied !== "string" || !equal(supplied, csrf(db, value)))
      throw new Problem(403, "CSRF_FAILED", "Refresh the page and try again");
  }
  return {
    id: audience === "admin" ? s.admin_id : s.user_id,
    email: s.email,
    name: s.name,
    audience: s.audience,
    sessionId: s.id,
    sessionHash: s.token_hash,
    authVersion: s.auth_version,
    mfaAt: s.mfa_at,
  };
}
export function requireUser(db: Database) {
  return async (req: FastifyRequest) => {
    req.principal = await principal(db, req);
  };
}
export function requireAdmin(db: Database) {
  return async (req: FastifyRequest) => {
    req.principal = await principal(db, req, "admin");
  };
}
export async function sendMail(
  db: Database,
  to: string,
  subject: string,
  text: string,
  challengeId?: string,
  timeoutMs?: number,
) {
  if (db.config.DEV_MAILBOX && db.config.NODE_ENV !== "production") {
    const mailbox = path.resolve(db.config.DATA_DIR, "mailbox");
    await mkdir(mailbox, { recursive: true });
    await writeFile(
      path.join(mailbox, `${challengeId ?? token()}.json`),
      JSON.stringify({ to, subject, text, at: new Date().toISOString() }),
      { mode: 0o600 },
    );
    return;
  }
  if (!db.config.SMTP_URL)
    throw new Problem(
      503,
      "MAIL_UNAVAILABLE",
      "Email delivery is not configured",
    );
  // Invitation delivery uses a bounded attempt so it cannot occupy the worker's
  // maintenance loop indefinitely. Override URL query options as well.
  const smtpUrl = new URL(db.config.SMTP_URL);
  if (timeoutMs)
    for (const option of [
      "connectionTimeout",
      "greetingTimeout",
      "socketTimeout",
    ])
      smtpUrl.searchParams.set(option, String(timeoutMs));
  const mail = nodemailer.createTransport(smtpUrl.href);
  try {
    await mail.sendMail({ from: db.config.MAIL_FROM, to, subject, text });
  } catch {
    throw new Problem(
      503,
      "MAIL_UNAVAILABLE",
      "Email delivery failed. Please try again later.",
    );
  } finally {
    mail.close();
  }
}
export function setSessionCookie(
  db: Database,
  reply: FastifyReply,
  value: string,
  admin = false,
) {
  reply.setCookie(admin ? "cp_admin_session" : "cp_session", value, {
    httpOnly: true,
    secure: db.config.NODE_ENV === "production",
    sameSite: "lax",
    path: admin ? "/v1/admin" : "/v1",
    maxAge: admin ? 8 * 3600 : 7 * 86400,
  });
}
export function totp(secret: string) {
  return new OTPAuth.TOTP({
    issuer: "CopyPaste Admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export function registerAuth(app: FastifyInstance, db: Database) {
  for (const audience of ["user", "admin"] as const) {
    const prefix = audience === "admin" ? "/v1/admin/auth" : "/v1/auth";
    const createChallenge = async (
      req: FastifyRequest,
      reply: FastifyReply,
      canonical = false,
    ) => {
      if (canonical) authRequestKey(req);
      const body = z.object({ email }).strict().parse(req.body);
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const flow = canonical ? (req.cookies.cp_auth_flow ?? token()) : null;
      const work = async (tx: Tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `challenge:${audience}:${body.email}`,
        ]);
        const recent = await tx.query(
          "SELECT count(*)::int AS n FROM auth_challenges WHERE email=$1 AND audience=$2 AND created_at>now()-interval '1 minute'",
          [body.email, audience],
        );
        if (recent.rows[0].n >= 2)
          throw new Problem(
            429,
            "RATE_LIMITED",
            "請稍後再試 / Please wait before requesting another code",
          );
        const { rows } = await tx.query(
          "INSERT INTO auth_challenges(email,audience,digest,expires_at,client_flow_hash) VALUES($1,$2,$3,now()+interval '10 minutes',$4) RETURNING id,expires_at",
          [
            body.email,
            audience,
            hmac(db.config.MASTER_KEY!, `${audience}:${body.email}:${code}`),
            flow ? hash(flow) : null,
          ],
        );
        return { ...rows[0], code, flow } as {
          id: string;
          expires_at: Date;
          code: string;
          flow: string | null;
        };
      };
      const challenge = canonical
        ? await authRequest(db, req, "challenge", body, work)
        : await db.tx(work, undefined, audience === "admin");
      // Never disclose whether a platform admin exists.
      const permitted =
        audience === "user" ||
        !!(
          await db.control.query(
            "SELECT 1 FROM admin_principals WHERE email=$1 AND status='active'",
            [body.email],
          )
        ).rowCount;
      const deliver = () =>
        sendMail(
          db,
          body.email,
          "CopyPaste · 登入驗證碼 / Sign-in code",
          `Your CopyPaste code is ${challenge.code}. It expires in 10 minutes. 如非本人操作，請忽略本郵件。`,
          challenge.id,
        );
      if (canonical) {
        reply.setCookie("cp_auth_flow", challenge.flow!, {
          httpOnly: true,
          secure: db.config.NODE_ENV === "production",
          sameSite: "lax",
          path: "/v1/auth",
          maxAge: 600,
        });
        await deliverAuthChallenge(db, req, deliver);
        reply.code(202);
        return {
          challenge_id: challenge.id,
          expires_at: new Date(challenge.expires_at).toISOString(),
        };
      }
      if (permitted) await deliver();
      return {
        challenge_id: challenge.id,
        expires_in: 600,
        delivery: db.config.DEV_MAILBOX ? "local_mailbox" : "email",
      };
    };
    app.post(prefix + "/challenge", (req, reply) =>
      createChallenge(req, reply),
    );
    if (audience === "user")
      app.post("/v1/auth/challenges", (req, reply) =>
        createChallenge(req, reply, true),
      );
    const createSession = async (
      req: FastifyRequest,
      reply: FastifyReply,
      canonical = false,
    ) => {
      if (canonical) authRequestKey(req);
      const schema = z
        .object({
          challenge_id: uuid,
          code: z.string().regex(/^\d{6}$/),
          name: name.optional(),
          totp: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .strict();
      const body: {
        challenge_id: string;
        code: string;
        name?: string;
        totp?: string;
      } = (
        canonical ? schema.pick({ challenge_id: true, code: true }) : schema
      ).parse(req.body);
      const work = async (tx: Tx) => {
        const q = await tx.query(
          "SELECT *, expires_at>now() AS valid FROM auth_challenges WHERE id=$1 AND audience=$2 AND purpose='login' FOR UPDATE",
          [body.challenge_id, audience],
        );
        const c = q.rows[0];
        if (!c || !c.valid || c.consumed_at || c.attempts >= 5)
          return { error: true } as const;
        if (
          (canonical && !c.client_flow_hash) ||
          (c.client_flow_hash &&
            (!req.cookies.cp_auth_flow ||
              !equal(c.client_flow_hash, hash(req.cookies.cp_auth_flow))))
        )
          return { error: true } as const;
        await tx.query(
          "UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1",
          [c.id],
        );
        if (
          !equal(
            c.digest,
            hmac(db.config.MASTER_KEY!, `${audience}:${c.email}:${body.code}`),
          )
        )
          return { error: true } as const;
        let person;
        if (audience === "admin") {
          person = (
            await tx.query(
              "SELECT * FROM admin_principals WHERE email=$1 FOR UPDATE",
              [c.email],
            )
          ).rows[0];
          if (
            !person ||
            person.status !== "active" ||
            person.enrollment_state !== "enrolled" ||
            !person.totp_secret ||
            !body.totp
          )
            return { error: true } as const;
          const verifier = totp(
            unseal(db.config.MASTER_KEY!, person.totp_secret),
          );
          const delta = verifier.validate({ token: body.totp, window: 1 });
          const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
          if (delta === null || step <= Number(person.last_totp_step))
            return { error: true } as const;
          await tx.query(
            "UPDATE admin_principals SET last_totp_step=$2 WHERE id=$1",
            [person.id, step],
          );
        } else {
          person = (
            await tx.query(
              "INSERT INTO users(email,name) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING *",
              [c.email, body.name ?? c.email.split("@")[0]],
            )
          ).rows[0];
          if (person.status !== "active") return { error: true } as const;
        }
        await tx.query(
          "UPDATE auth_challenges SET consumed_at=now() WHERE id=$1",
          [c.id],
        );
        const value = token();
        const s = await tx.query(
          `INSERT INTO sessions(token_hash,${audience === "admin" ? "admin_id" : "user_id"},audience,auth_version,expires_at,mfa_at) VALUES($1,$2,$3,$4,now()+$5::interval,$6) RETURNING id,expires_at`,
          [
            hash(value),
            person.id,
            audience,
            person.auth_version,
            audience === "admin" ? "8 hours" : "7 days",
            audience === "admin" ? new Date() : null,
          ],
        );
        if (audience === "user")
          await tx.query("UPDATE users SET last_login_at=now() WHERE id=$1", [
            person.id,
          ]);
        await audit(
          tx,
          { id: person.id, audience },
          "auth.login",
          s.rows[0].id,
        );
        return {
          value,
          expires_at: (s.rows[0].expires_at as Date).toISOString(),
          user: {
            id: person.id,
            email: person.email,
            name: person.name,
            locale: person.locale,
          },
          csrf: csrf(db, value),
        };
      };
      const result = canonical
        ? await authRequest(db, req, "session", body, work)
        : await db.tx(work, undefined, audience === "admin");
      if ("error" in result)
        throw new Problem(
          401,
          "INVALID_CODE",
          "驗證碼無效或已過期 / Invalid or expired code",
        );
      setSessionCookie(db, reply, result.value, audience === "admin");
      if (canonical) {
        reply.code(201);
        return {
          user: {
            id: result.user.id,
            email: result.user.email,
            display_name: result.user.name,
          },
          expires_at: result.expires_at,
          csrf_token: result.csrf,
        };
      }
      return { user: result.user, csrf_token: result.csrf };
    };
    app.post(prefix + "/verify", (req, reply) => createSession(req, reply));
    if (audience === "user")
      app.post("/v1/auth/sessions", (req, reply) =>
        createSession(req, reply, true),
      );
    const logout = async (
      req: FastifyRequest,
      reply: FastifyReply,
      canonical = false,
    ) => {
      if (canonical) authRequestKey(req);
      await db.tx(
        async (tx) => {
          if (audience === "user")
            await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
              req.principal.id,
            ]);
          await tx.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
            req.principal.sessionId,
          ]);
          if (audience === "user") {
            await tx.query(
              "UPDATE refresh_tokens SET revoked_at=now() WHERE family_id IN (SELECT family_id FROM refresh_tokens WHERE session_id=$1)",
              [req.principal.sessionId],
            );
            await tx.query(
              "UPDATE sessions SET revoked_at=now() WHERE id IN (SELECT session_id FROM refresh_tokens WHERE family_id IN (SELECT family_id FROM refresh_tokens WHERE session_id=$1))",
              [req.principal.sessionId],
            );
          }
          await audit(
            tx,
            req.principal,
            "auth.logout",
            req.principal.sessionId,
          );
        },
        undefined,
        audience === "admin",
      );
      reply.clearCookie(
        audience === "admin" ? "cp_admin_session" : "cp_session",
        { path: audience === "admin" ? "/v1/admin" : "/v1" },
      );
      if (audience === "user")
        reply.clearCookie("cp_auth_flow", { path: "/v1/auth" });
      return { ok: true };
    };
    app.post(
      prefix + "/logout",
      { preHandler: audience === "admin" ? requireAdmin(db) : requireUser(db) },
      (req, reply) => logout(req, reply),
    );
    if (audience === "user")
      app.delete("/v1/auth/session", async (req, reply) => {
        authRequestKey(req);
        try {
          req.principal = await principal(db, req);
        } catch (error) {
          if (!(error instanceof Problem) || error.status !== 401) throw error;
          reply.clearCookie("cp_session", { path: "/v1" });
          reply.clearCookie("cp_auth_flow", { path: "/v1/auth" });
          return { ok: true };
        }
        return logout(req, reply, true);
      });
  }
  app.get("/v1/me", { preHandler: requireUser(db) }, async (req) => {
    return {
      id: req.principal.id,
      email: req.principal.email,
      display_name: req.principal.name,
    };
  });
  app.get(
    "/v1/session/context",
    { preHandler: requireUser(db) },
    async (req) => {
      const u = (
        await db.app.query(
          "SELECT id,email,name,locale FROM users WHERE id=$1",
          [req.principal.id],
        )
      ).rows[0];
      if (!u) throw new Problem(401, "SESSION_EXPIRED", "Session expired");
      const memberships = (
        await db.app.query(
          "SELECT t.id,t.name,t.data_mode,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=$1 AND m.status='active' AND t.status='active' ORDER BY t.created_at",
          [u.id],
        )
      ).rows;
      return {
        user: u,
        memberships,
        csrf_token:
          req.principal.audience === "user" && req.cookies.cp_session
            ? csrf(db, req.cookies.cp_session)
            : null,
      };
    },
  );
  app.patch("/v1/me", { preHandler: requireUser(db) }, async (req) => {
    const b = z
      .object({
        name: name.optional(),
        locale: z.enum(["zh-HK", "en"]).optional(),
      })
      .strict()
      .parse(req.body);
    return (
      await db.app.query(
        "UPDATE users SET name=coalesce($2,name),locale=coalesce($3,locale) WHERE id=$1 RETURNING id,email,name,locale",
        [req.principal.id, b.name ?? null, b.locale ?? null],
      )
    ).rows[0];
  });
  app.get("/v1/me/sessions", { preHandler: requireUser(db) }, async (req) => ({
    items: (
      await db.app.query(
        `SELECT s.id,s.audience,s.created_at,s.expires_at,
          CASE WHEN s.audience='native' THEN f.client_id ELSE 'web' END AS client_id,
          f.expires_at AS refresh_expires_at,s.id=$2::uuid AS current
        FROM sessions s LEFT JOIN refresh_tokens f ON f.session_id=s.id
          AND f.used_at IS NULL AND f.revoked_at IS NULL AND f.expires_at>now()
        WHERE s.user_id=$1 AND s.revoked_at IS NULL AND s.auth_version=$3
          AND ((s.audience='user' AND s.expires_at>now())
            OR (s.audience='native' AND f.digest IS NOT NULL))
        ORDER BY s.created_at DESC,s.id`,
        [req.principal.id, req.principal.sessionId, req.principal.authVersion],
      )
    ).rows,
  }));
  app.delete(
    "/v1/me/sessions/:id",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id);
      await db.tx(async (tx) => {
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          req.principal.id,
        ]);
        await tx.query(
          "UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2",
          [id, req.principal.id],
        );
        await tx.query(
          "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$2 AND family_id IN (SELECT family_id FROM refresh_tokens WHERE session_id=$1)",
          [id, req.principal.id],
        );
        await tx.query(
          "UPDATE sessions SET revoked_at=now() WHERE user_id=$2 AND id IN (SELECT session_id FROM refresh_tokens WHERE family_id IN (SELECT family_id FROM refresh_tokens WHERE session_id=$1))",
          [id, req.principal.id],
        );
        await audit(tx, req.principal, "session.revoke", id);
      });
      if (id === req.principal.sessionId && req.principal.audience === "user") {
        reply.clearCookie("cp_session", { path: "/v1" });
        reply.clearCookie("cp_auth_flow", { path: "/v1/auth" });
      }
      return { ok: true };
    },
  );
  registerNativeAuth(app, db);
}
function redirectAllowed(db: Database, client: string, value: string) {
  const u = new URL(value);
  if (u.username || u.password) return false;
  if (client === "desktop")
    return (
      u.protocol === "http:" &&
      u.hostname === "127.0.0.1" &&
      /^\/callback$/.test(u.pathname) &&
      !!u.port &&
      !u.search &&
      !u.hash
    );
  return (
    !!db.config.EXTENSION_ID &&
    value === `https://${db.config.EXTENSION_ID}.chromiumapp.org/callback`
  );
}
function authorizeBrowserNavigation(db: Database, req: FastifyRequest) {
  if (req.principal.audience !== "user")
    throw new Problem(
      403,
      "BROWSER_SESSION_REQUIRED",
      "Use your signed-in browser to authorize a device",
    );
  const proof = req.headers["x-csrf-token"];
  if (
    typeof proof === "string" &&
    req.cookies.cp_session &&
    equal(proof, csrf(db, req.cookies.cp_session))
  )
    return;
  let trustedSource = false;
  try {
    trustedSource =
      new URL(String(req.headers.referer)).origin === db.config.WEB_ORIGIN;
  } catch {}
  if (
    req.headers["sec-fetch-mode"] !== "navigate" ||
    req.headers["sec-fetch-dest"] !== "document" ||
    req.headers["sec-fetch-user"] !== "?1" ||
    !(req.headers["sec-fetch-site"] === "same-origin" || trustedSource)
  )
    throw new Problem(
      403,
      "CONSENT_REQUIRED",
      "Return to the device authorization page and confirm access",
    );
}
function registerNativeAuth(app: FastifyInstance, db: Database) {
  const request = z
    .object({
      client_id: z.enum(["desktop", "extension"]),
      redirect_uri: z.string().url(),
      code_challenge: z.string().regex(/^[\w-]{43}$/),
      state: z.string().min(32).max(256),
    })
    .strict();
  const authorize = async (req: FastifyRequest, b: z.infer<typeof request>) => {
    if (req.principal.audience !== "user")
      throw new Problem(
        403,
        "BROWSER_SESSION_REQUIRED",
        "Use your signed-in browser to authorize a device",
      );
    if (!redirectAllowed(db, b.client_id, b.redirect_uri))
      throw new Problem(400, "INVALID_REDIRECT", "Unregistered callback URL");
    const code = token();
    await db.tx(async (tx) => {
      const person = (
        await tx.query(
          "SELECT status,auth_version FROM users WHERE id=$1 FOR UPDATE",
          [req.principal.id],
        )
      ).rows[0];
      const source = (
        await tx.query(
          "SELECT *,expires_at>now() AS valid FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
          [req.principal.sessionId, req.principal.id],
        )
      ).rows[0];
      if (
        !person ||
        person.status !== "active" ||
        person.auth_version !== req.principal.authVersion ||
        !source?.valid ||
        source.revoked_at ||
        source.auth_version !== person.auth_version ||
        !(await validFederation(tx, source))
      )
        throw new Problem(401, "SESSION_EXPIRED", "Please sign in again");
      await tx.query(
        "INSERT INTO native_auth_codes(digest,user_id,challenge,client_id,redirect_uri,expires_at,source_session_id,issued_auth_version) VALUES($1,$2,$3,$4,$5,now()+interval '60 seconds',$6,$7)",
        [
          hash(code),
          req.principal.id,
          b.code_challenge,
          b.client_id,
          b.redirect_uri,
          source.id,
          person.auth_version,
        ],
      );
    });
    const u = new URL(b.redirect_uri);
    u.searchParams.set("code", code);
    u.searchParams.set("state", b.state);
    return u.href;
  };
  app.post(
    "/v1/auth/native/authorize",
    { preHandler: requireUser(db) },
    async (req) => ({
      redirect: await authorize(req, request.parse(req.body)),
    }),
  );
  app.get(
    "/v1/auth/authorize",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { code_challenge_method: _, ...b } = request
        .extend({ code_challenge_method: z.literal("S256") })
        .parse(req.query);
      authorizeBrowserNavigation(db, req);
      return reply
        .code(302)
        .header("Location", await authorize(req, b))
        .send();
    },
  );
  const codeRequest = z
    .object({
      client_id: z.enum(["desktop", "extension"]),
      redirect_uri: z.string().url(),
      code: z.string().min(40).max(100),
      code_verifier: z.string().regex(/^[\w.~-]{43,128}$/),
    })
    .strict();
  const exchangeCode = async (
    b: z.infer<typeof codeRequest>,
    req?: FastifyRequest,
  ) => {
    if (!redirectAllowed(db, b.client_id, b.redirect_uri))
      throw new Problem(400, "INVALID_GRANT", "Invalid native authorization");
    const work = async (tx: Tx) => {
      const owner = (
        await tx.query(
          "SELECT user_id FROM native_auth_codes WHERE digest=$1",
          [hash(b.code)],
        )
      ).rows[0];
      if (!owner) return null;
      const u = (
        await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          owner.user_id,
        ])
      ).rows[0];
      const c = (
        await tx.query(
          "SELECT *,expires_at>now() AS valid FROM native_auth_codes WHERE digest=$1 FOR UPDATE",
          [hash(b.code)],
        )
      ).rows[0];
      if (
        !c ||
        !c.valid ||
        c.consumed_at ||
        c.client_id !== b.client_id ||
        c.redirect_uri !== b.redirect_uri ||
        !equal(
          c.challenge,
          Buffer.from(hash(b.code_verifier), "hex").toString("base64url"),
        )
      )
        return null;
      const source = (
        await tx.query(
          "SELECT *,expires_at>now() AS valid FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
          [c.source_session_id, u.id],
        )
      ).rows[0];
      if (
        u.status !== "active" ||
        c.issued_auth_version !== u.auth_version ||
        !source?.valid ||
        source.revoked_at ||
        source.auth_version !== u.auth_version ||
        !(await validFederation(tx, source))
      )
        return null;
      await tx.query(
        "UPDATE native_auth_codes SET consumed_at=now() WHERE digest=$1",
        [c.digest],
      );
      return issueNative(tx, u, b.client_id, undefined, source);
    };
    const r = req
      ? await authRequest(db, req, "code", b, work)
      : await db.tx(work);
    if (!r)
      throw new Problem(
        401,
        "INVALID_GRANT",
        "Invalid or expired authorization",
      );
    return r;
  };
  app.post("/v1/auth/native/token", (req) =>
    exchangeCode(codeRequest.parse(req.body)),
  );
  const refreshRequest = z
    .object({
      refresh_token: z.string().min(40).max(100),
      client_id: z.enum(["desktop", "extension"]),
    })
    .strict();
  const exchangeRefresh = async (
    b: z.infer<typeof refreshRequest>,
    req?: FastifyRequest,
  ) => {
    const work = async (tx: Tx) => {
      const owner = (
        await tx.query("SELECT user_id FROM refresh_tokens WHERE digest=$1", [
          hash(b.refresh_token),
        ])
      ).rows[0];
      if (!owner) return null;
      const u = (
        await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          owner.user_id,
        ])
      ).rows[0];
      const f = (
        await tx.query(
          "SELECT *,expires_at>now() AS valid FROM refresh_tokens WHERE digest=$1 FOR UPDATE",
          [hash(b.refresh_token)],
        )
      ).rows[0];
      if (!f || f.client_id !== b.client_id) return null;
      if (f.used_at || f.revoked_at) {
        await tx.query(
          "UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1",
          [f.family_id],
        );
        await tx.query(
          "UPDATE sessions SET revoked_at=now() WHERE id IN (SELECT session_id FROM refresh_tokens WHERE family_id=$1)",
          [f.family_id],
        );
        return null;
      }
      const source = (
        await tx.query("SELECT * FROM sessions WHERE id=$1 AND user_id=$2", [
          f.session_id,
          u.id,
        ])
      ).rows[0];
      if (
        !f.valid ||
        u.status !== "active" ||
        f.auth_version !== u.auth_version ||
        !source ||
        source.revoked_at ||
        source.auth_version !== u.auth_version ||
        !(await validFederation(tx, source))
      )
        return null;
      await tx.query(
        "UPDATE refresh_tokens SET used_at=now() WHERE digest=$1",
        [f.digest],
      );
      await tx.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
        f.session_id,
      ]);
      return issueNative(tx, u, b.client_id, f.family_id, source);
    };
    const r = req
      ? await authRequest(db, req, "refresh", b, work)
      : await db.tx(work);
    if (!r) throw new Problem(401, "INVALID_GRANT", "Please sign in again");
    return r;
  };
  app.post("/v1/auth/native/refresh", (req) =>
    exchangeRefresh(refreshRequest.parse(req.body)),
  );
  const tokenRequest = z.discriminatedUnion("grant_type", [
    codeRequest.extend({ grant_type: z.literal("authorization_code") }),
    refreshRequest.extend({ grant_type: z.literal("refresh_token") }),
  ]);
  app.post("/v1/auth/token", async (req, reply) => {
    authRequestKey(req);
    const body = tokenRequest.parse(req.body);
    const result =
      body.grant_type === "authorization_code"
        ? await exchangeCode(body, req)
        : await exchangeRefresh(body, req);
    return reply.code(201).send(result);
  });
  // Possession of a refresh credential revokes only its own client/family. This
  // still works after the short-lived access token expires, without rotating it.
  app.post("/v1/auth/native/revoke", async (req) => {
    const b = z
      .object({
        client_id: z.enum(["desktop", "extension"]),
        refresh_token: z.string().min(40).max(100),
      })
      .strict()
      .parse(req.body);
    await db.tx(async (tx) => {
      const owner = (
        await tx.query("SELECT user_id FROM refresh_tokens WHERE digest=$1", [
          hash(b.refresh_token),
        ])
      ).rows[0];
      if (!owner) return;
      // Same lock order as refresh/logout/session revoke: user before credential.
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        owner.user_id,
      ]);
      const f = (
        await tx.query(
          "SELECT * FROM refresh_tokens WHERE digest=$1 FOR UPDATE",
          [hash(b.refresh_token)],
        )
      ).rows[0];
      if (!f || f.client_id !== b.client_id) return;
      await tx.query(
        "UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1 AND user_id=$2",
        [f.family_id, f.user_id],
      );
      await tx.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$2 AND id IN (SELECT session_id FROM refresh_tokens WHERE family_id=$1)",
        [f.family_id, f.user_id],
      );
      await audit(
        tx,
        { id: f.user_id, audience: "native" },
        "session.native_revoke",
        f.session_id,
        "succeeded",
        { client_id: f.client_id },
      );
    });
    // Unknown, expired and already revoked credentials receive the same receipt.
    return { ok: true };
  });
}
async function issueNative(
  tx: Tx,
  user: any,
  client: string,
  family?: string,
  source?: any,
) {
  const access = token(),
    refresh = token();
  const s = (
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,audience,auth_version,expires_at,federation_identity_id,federation_revision) VALUES($1,$2,'native',$3,now()+interval '15 minutes',$4,$5) RETURNING id",
      [
        hash(access),
        user.id,
        user.auth_version,
        source?.federation_identity_id ?? null,
        source?.federation_revision ?? null,
      ],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO refresh_tokens(digest,family_id,user_id,session_id,client_id,auth_version,expires_at) VALUES($1,coalesce($2,gen_random_uuid()),$3,$4,$5,$6,now()+interval '30 days')",
    [hash(refresh), family ?? null, user.id, s.id, client, user.auth_version],
  );
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 900,
    token_type: "Bearer",
  };
}
