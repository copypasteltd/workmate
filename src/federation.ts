import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { domainToASCII } from "node:url";
import {
  audit,
  requireAdmin,
  requireUser,
  sendMail,
  setSessionCookie,
} from "./auth.js";
import { permit, requireRecentMfa } from "./admin-access.js";
import { key, replay } from "./access.js";
import {
  canonical,
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
import {
  callbackUri,
  oidc,
  oidcUrl,
  probeProvider,
  providerClient,
  safeNext,
} from "./oidc-provider.js";
import { revokeFederatedUsers } from "./federation-session.js";

const browserCookie = "cp_sso_attempt";
const cookiePath = "/v1/auth/sso";
const capability = z.string().regex(/^[\w-]{43}$/);
const reason = z.string().trim().min(3).max(2000);
const loginKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform(domainToASCII)
  .refine(
    (v) =>
      v.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v),
    "Enter an email domain without a protocol or path",
  );
const connectionInput = z
  .object({
    expected_version: z.number().int().nonnegative(),
    reason,
    login_key: loginKey,
    name,
    issuer: z.string().trim().url().max(2048),
    client_id: z.string().trim().min(1).max(512),
    client_secret: z.string().min(8).max(8192).optional(),
    domains: z
      .array(domain)
      .min(1)
      .max(20)
      .transform((d) => [...new Set(d)].sort()),
    token_auth_method: z
      .enum(["client_secret_post", "client_secret_basic"])
      .default("client_secret_post"),
    signing_alg: z.enum(["RS256", "ES256"]).default("RS256"),
    email_mode: z
      .enum(["verified_email", "subject_with_proof"])
      .default("verified_email"),
  })
  .strict();

function browserHash(req: FastifyRequest) {
  const value = req.cookies[browserCookie];
  if (!capability.safeParse(value).success)
    throw new Problem(
      401,
      "SSO_ATTEMPT_INVALID",
      "Start company sign-in again",
    );
  return hash(value!);
}
function sameWeb(db: Database, req: FastifyRequest) {
  if (req.headers.origin !== db.config.WEB_ORIGIN)
    throw new Problem(
      403,
      "ORIGIN_DENIED",
      "Company sign-in must begin in the registered Web application",
    );
}
function setBrowser(db: Database, reply: FastifyReply, value: string) {
  reply.setCookie(browserCookie, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: db.config.NODE_ENV === "production",
    path: cookiePath,
    maxAge: 600,
  });
}
function clearBrowser(reply: FastifyReply) {
  reply.clearCookie(browserCookie, { path: cookiePath });
}
function invalidAttempt() {
  return new Problem(
    401,
    "SSO_ATTEMPT_INVALID",
    "This company sign-in expired or changed. Start again",
  );
}
function active(p: any, a?: any) {
  if (
    !p ||
    !p.enabled ||
    p.tenant_status !== "active" ||
    p.verified_revision !== p.revision ||
    (a && a.revision !== p.revision)
  )
    throw invalidAttempt();
}
function allowedEmail(p: any, address: string) {
  return p.domains.includes(domainToASCII(address.split("@")[1] ?? ""));
}
async function connection(tx: Tx, id: string, lock = false) {
  return (
    await tx.query(
      `SELECT c.*,t.name AS tenant_name,t.status AS tenant_status FROM sso_connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.id=$1 ${lock ? "FOR UPDATE OF c" : ""}`,
      [id],
    )
  ).rows[0];
}
async function publicConnection(tx: Tx, tenant: string) {
  return (
    (
      await tx.query(
        `SELECT id,tenant_id,login_key,name,issuer,client_id,domains,token_auth_method,signing_alg,email_mode,
    enabled,version,revision,verified_revision,last_probed_at,metadata,created_at,updated_at,true AS secret_configured,
    (SELECT count(*)::int FROM federated_identities i WHERE i.connection_id=c.id AND i.status='active') AS linked_users
    FROM sso_connections c WHERE tenant_id=$1`,
        [tenant],
      )
    ).rows[0] ?? null
  );
}
async function member(tx: Tx, p: any, address: string) {
  const u = (
    await tx.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [address])
  ).rows[0];
  if (
    !u ||
    u.status !== "active" ||
    !(
      await tx.query(
        "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
        [p.tenant_id, u.id],
      )
    ).rowCount
  )
    throw new Problem(
      403,
      "SSO_MEMBERSHIP_REQUIRED",
      "Verify your work email and accept a workspace invitation before using company sign-in",
    );
  return u;
}
async function issue(
  tx: Tx,
  db: Database,
  p: any,
  person: any,
  identity: any,
  a: any,
) {
  const value = token();
  const session = (
    await tx.query(
      `INSERT INTO sessions(token_hash,user_id,audience,auth_version,expires_at,federation_identity_id,federation_revision)
    VALUES($1,$2,'user',$3,now()+interval '8 hours',$4,$5) RETURNING id`,
      [hash(value), person.id, person.auth_version, identity.id, p.revision],
    )
  ).rows[0];
  await tx.query(
    "UPDATE federated_identities SET last_login_at=now() WHERE id=$1",
    [identity.id],
  );
  await tx.query(
    "UPDATE federation_attempts SET phase='complete',secrets=NULL,completed_at=now() WHERE id=$1",
    [a.id],
  );
  await audit(
    tx,
    { id: person.id, audience: "user" },
    "auth.sso.login",
    session.id,
    "succeeded",
    { connection_id: p.id, revision: p.revision },
    p.tenant_id,
  );
  return { value, next: a.next_path };
}
async function pending(tx: Tx, req: FastifyRequest) {
  const a = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM federation_attempts WHERE browser_hash=$1 FOR UPDATE",
      [browserHash(req)],
    )
  ).rows[0];
  if (!a?.valid || a.phase !== "awaiting_link" || !a.subject)
    throw invalidAttempt();
  const p = await connection(tx, a.connection_id, true);
  active(p, a);
  if (!allowedEmail(p, a.email)) throw invalidAttempt();
  return { a, p };
}

export function registerFederation(app: FastifyInstance, db: Database) {
  const adminBase = "/v1/admin/tenants/:tenant/sso";
  app.get(adminBase, { preHandler: requireAdmin(db) }, async (req) => {
    const tenant = uuid.parse((req.params as any).tenant);
    return db.tx(
      async (tx) => {
        await permit(tx, req.principal, "admin.tenants.read", { tenant });
        const t = (
          await tx.query("SELECT id,name,status FROM tenants WHERE id=$1", [
            tenant,
          ])
        ).rows[0];
        if (!t) throw new Problem(404, "NOT_FOUND", "Workspace not found");
        return {
          tenant: t,
          connection: await publicConnection(tx, tenant),
          callback_uri: callbackUri(db.config),
        };
      },
      undefined,
      true,
    );
  });
  app.post(adminBase, { preHandler: requireAdmin(db) }, async (req) => {
    const tenant = uuid.parse((req.params as any).tenant),
      b = connectionInput.parse(req.body);
    oidcUrl(db.config, b.issuer, true);
    return db.tx(
      async (tx) => {
        await requireRecentMfa(tx, req.principal);
        await permit(tx, req.principal, "admin.tenants.sso.write");
        await permit(tx, req.principal, "admin.tenants.read", { tenant });
        return replay(
          tx,
          req.principal.id,
          "sso.save:" + tenant,
          key(req),
          b,
          async () => {
            if (
              !(
                await tx.query("SELECT 1 FROM tenants WHERE id=$1 FOR UPDATE", [
                  tenant,
                ])
              ).rowCount
            )
              throw new Problem(404, "NOT_FOUND", "Workspace not found");
            const old = (
              await tx.query(
                "SELECT * FROM sso_connections WHERE tenant_id=$1 FOR UPDATE",
                [tenant],
              )
            ).rows[0];
            if ((old?.version ?? 0) !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Refresh the connection before saving",
              );
            if (!old && !b.client_secret)
              throw new Problem(
                400,
                "SSO_SECRET_REQUIRED",
                "A new confidential client needs its secret",
              );
            const secret = b.client_secret
              ? seal(db.config.MASTER_KEY!, b.client_secret)
              : old.client_secret;
            if (old) {
              await revokeFederatedUsers(tx, old.id);
              await tx.query(
                `UPDATE sso_connections SET login_key=$2,name=$3,issuer=$4,client_id=$5,client_secret=$6,domains=$7,
            token_auth_method=$8,signing_alg=$9,email_mode=$10,version=version+1,revision=revision+1,enabled=false,metadata=NULL,verified_revision=NULL,updated_at=now() WHERE id=$1`,
                [
                  old.id,
                  b.login_key,
                  b.name,
                  b.issuer,
                  b.client_id,
                  secret,
                  JSON.stringify(b.domains),
                  b.token_auth_method,
                  b.signing_alg,
                  b.email_mode,
                ],
              );
            } else
              await tx.query(
                `INSERT INTO sso_connections(tenant_id,login_key,name,issuer,client_id,client_secret,domains,token_auth_method,signing_alg,email_mode,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                  tenant,
                  b.login_key,
                  b.name,
                  b.issuer,
                  b.client_id,
                  secret,
                  JSON.stringify(b.domains),
                  b.token_auth_method,
                  b.signing_alg,
                  b.email_mode,
                  req.principal.id,
                ],
              );
            const result = await publicConnection(tx, tenant);
            await audit(
              tx,
              req.principal,
              "admin.sso.save",
              result.id,
              "succeeded",
              { reason: b.reason, revision: result.revision },
              tenant,
            );
            return result;
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post(
    adminBase + "/probe",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant),
        b = z
          .object({ expected_version: z.number().int().positive(), reason })
          .strict()
          .parse(req.body),
        requestKey = key(req);
      // External metadata retrieval does not hold a database transaction or lock.
      const p = await db.tx(
        async (tx) => {
          await requireRecentMfa(tx, req.principal);
          await permit(tx, req.principal, "admin.tenants.sso.write");
          await permit(tx, req.principal, "admin.tenants.read", { tenant });
          const row = (
            await tx.query("SELECT * FROM sso_connections WHERE tenant_id=$1", [
              tenant,
            ])
          ).rows[0];
          if (!row)
            throw new Problem(
              404,
              "NOT_FOUND",
              "Identity connection not found",
            );
          const cached = (
            await tx.query(
              "SELECT * FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
              [req.principal.id, "sso.probe:" + row.id, requestKey],
            )
          ).rows[0];
          if (cached) {
            if (cached.revoked_at)
              throw new Problem(
                410,
                "REQUEST_RESULT_REMOVED",
                "This validation result was removed",
              );
            if (cached.input_hash !== hash(canonical(b)))
              throw new Problem(
                409,
                "IDEMPOTENCY_CONFLICT",
                "This request key was used with different content",
              );
            return { cached: cached.response };
          }
          if (row.version !== b.expected_version)
            throw new Problem(
              409,
              "VERSION_CONFLICT",
              "Refresh the connection",
            );
          if (row.enabled)
            throw new Problem(
              409,
              "SSO_DISABLE_FIRST",
              "Disable this connection before checking new metadata",
            );
          return { provider: row };
        },
        undefined,
        true,
      );
      if ("cached" in p) return p.cached;
      const provider = p.provider;
      let md;
      try {
        md = await probeProvider(db.config, provider);
      } catch (error) {
        if (error instanceof Problem) throw error;
        throw new Problem(
          502,
          "SSO_PROBE_FAILED",
          "Unable to validate the configured discovery document and public keys",
        );
      }
      return db.tx(
        async (tx) => {
          await requireRecentMfa(tx, req.principal);
          await permit(tx, req.principal, "admin.tenants.sso.write");
          await permit(tx, req.principal, "admin.tenants.read", { tenant });
          return replay(
            tx,
            req.principal.id,
            "sso.probe:" + provider.id,
            requestKey,
            b,
            async () => {
              const current = await connection(tx, provider.id, true);
              if (current.version !== b.expected_version || current.enabled)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "The connection changed during validation",
                );
              await revokeFederatedUsers(tx, provider.id);
              await tx.query(
                "UPDATE sso_connections SET metadata=$2,version=version+1,revision=revision+1,verified_revision=revision+1,last_probed_at=now(),updated_at=now() WHERE id=$1",
                [provider.id, JSON.stringify(md)],
              );
              await audit(
                tx,
                req.principal,
                "admin.sso.probe",
                provider.id,
                "succeeded",
                {
                  reason: b.reason,
                  validation: "discovery_and_public_keys_only",
                },
                tenant,
              );
              return publicConnection(tx, tenant);
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    adminBase + "/status",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant),
        b = z
          .object({
            expected_version: z.number().int().positive(),
            action: z.enum(["enable", "disable"]),
            reason,
          })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          await requireRecentMfa(tx, req.principal);
          await permit(tx, req.principal, "admin.tenants.sso.write");
          await permit(tx, req.principal, "admin.tenants.read", { tenant });
          return replay(
            tx,
            req.principal.id,
            "sso.status:" + tenant,
            key(req),
            b,
            async () => {
              const p = (
                await tx.query(
                  "SELECT * FROM sso_connections WHERE tenant_id=$1 FOR UPDATE",
                  [tenant],
                )
              ).rows[0];
              if (!p)
                throw new Problem(
                  404,
                  "NOT_FOUND",
                  "Identity connection not found",
                );
              if (p.version !== b.expected_version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Refresh the connection",
                );
              if (
                b.action === "enable" &&
                (p.verified_revision !== p.revision || !p.metadata)
              )
                throw new Problem(
                  409,
                  "SSO_NOT_VERIFIED",
                  "Check identity metadata and keys before enabling",
                );
              const enabled = b.action === "enable";
              if (p.enabled !== enabled) {
                if (!enabled) await revokeFederatedUsers(tx, p.id);
                await tx.query(
                  "UPDATE sso_connections SET enabled=$2,version=version+1,updated_at=now() WHERE id=$1",
                  [p.id, enabled],
                );
              }
              await audit(
                tx,
                req.principal,
                "admin.sso." + b.action,
                p.id,
                "succeeded",
                { reason: b.reason },
                tenant,
              );
              return publicConnection(tx, tenant);
            },
          );
        },
        undefined,
        true,
      );
    },
  );

  app.post("/v1/auth/sso/start", async (req, reply) => {
    sameWeb(db, req);
    const b = z
      .object({
        email,
        login_key: loginKey,
        next: z.string().max(2048).default("/app"),
      })
      .strict()
      .parse(req.body);
    const next = safeNext(db.config, b.next),
      state = token(),
      browser = token(),
      nonce = token(),
      verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const p = await db.tx(
      async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "sso-start:" + b.email,
        ]);
        const row = (
          await tx.query(
            "SELECT c.*,t.status AS tenant_status FROM sso_connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.login_key=$1",
            [b.login_key],
          )
        ).rows[0];
        if (
          !row ||
          !row.enabled ||
          row.tenant_status !== "active" ||
          !allowedEmail(row, b.email)
        )
          throw new Problem(
            503,
            "SSO_UNAVAILABLE",
            "Company sign-in is unavailable for these details. Use email sign-in or contact your administrator",
          );
        const recent = (
          await tx.query(
            "SELECT count(*)::int AS n FROM federation_attempts WHERE email=$1 AND created_at>now()-interval '1 minute'",
            [b.email],
          )
        ).rows[0].n;
        if (recent >= 5)
          throw new Problem(
            429,
            "RATE_LIMITED",
            "Wait before starting another company sign-in",
          );
        await tx.query(
          `INSERT INTO federation_attempts(connection_id,revision,state_hash,browser_hash,email,next_path,secrets,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
          [
            row.id,
            row.revision,
            hash(state),
            hash(browser),
            b.email,
            next,
            seal(db.config.MASTER_KEY!, JSON.stringify({ nonce, verifier })),
          ],
        );
        return row;
      },
      undefined,
      true,
    );
    const url = oidc.buildAuthorizationUrl(providerClient(db.config, p), {
      redirect_uri: callbackUri(db.config),
      scope: "openid email profile",
      response_mode: "query",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: b.email,
    });
    setBrowser(db, reply, browser);
    return { redirect: url.href };
  });
  app.get("/v1/auth/sso/callback", async (req, reply) => {
    let claimed: any;
    try {
      const q = z.object({ state: capability }).passthrough().parse(req.query);
      const browser = browserHash(req);
      claimed = await db.tx(
        async (tx) => {
          const a = (
            await tx.query(
              "SELECT *,expires_at>now() AS valid FROM federation_attempts WHERE state_hash=$1 AND browser_hash=$2 FOR UPDATE",
              [hash(q.state), browser],
            )
          ).rows[0];
          if (!a?.valid || a.phase !== "initiated" || !a.secrets)
            throw invalidAttempt();
          const p = await connection(tx, a.connection_id);
          active(p, a);
          await tx.query(
            "UPDATE federation_attempts SET phase='exchanging' WHERE id=$1",
            [a.id],
          );
          return { a, p };
        },
        undefined,
        true,
      );
      const { a, p } = claimed,
        secrets = JSON.parse(unseal(db.config.MASTER_KEY!, a.secrets));
      const current = new URL(callbackUri(db.config));
      current.search = req.url.split("?").slice(1).join("?");
      const tokens = await oidc.authorizationCodeGrant(
        providerClient(db.config, p),
        current,
        {
          expectedState: q.state,
          expectedNonce: secrets.nonce,
          pkceCodeVerifier: secrets.verifier,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      const rawSubject = z
        .string()
        .min(1)
        .max(255)
        .regex(/^[\x21-\x7e]+$/)
        .parse(claims?.sub);
      // A replacement issuer/client can reuse the same raw sub for another
      // person. Bind within the original trust namespace, never by sub alone.
      const subject = hash(
        canonical({
          issuer: p.issuer,
          client_id: p.client_id,
          sub: rawSubject,
        }),
      );
      if (
        p.email_mode === "verified_email" &&
        (claims?.email_verified !== true ||
          email.parse(claims.email) !== a.email)
      )
        throw new Problem(
          401,
          "SSO_EMAIL_MISMATCH",
          "The verified company email must match your sign-in email",
        );
      const result = await db.tx(
        async (tx) => {
          const currentAttempt = (
            await tx.query(
              "SELECT *,expires_at>now() AS valid FROM federation_attempts WHERE id=$1 FOR UPDATE",
              [a.id],
            )
          ).rows[0];
          const latest = await connection(tx, p.id, true);
          active(latest, currentAttempt);
          if (
            !currentAttempt?.valid ||
            currentAttempt.phase !== "exchanging" ||
            !allowedEmail(latest, a.email)
          )
            throw invalidAttempt();
          const person = await member(tx, latest, a.email);
          const identity = (
            await tx.query(
              "SELECT * FROM federated_identities WHERE connection_id=$1 AND subject=$2",
              [p.id, subject],
            )
          ).rows[0];
          if (identity && identity.user_id !== person.id)
            throw invalidAttempt();
          await tx.query(
            "UPDATE federation_attempts SET subject=$2,secrets=NULL,phase='awaiting_link' WHERE id=$1",
            [a.id, subject],
          );
          if (
            identity?.status === "active" &&
            identity.revision === latest.revision
          )
            return issue(tx, db, latest, person, identity, currentAttempt);
          return null;
        },
        undefined,
        true,
      );
      if (result) {
        clearBrowser(reply);
        setSessionCookie(db, reply, result.value);
        return reply.redirect(db.config.WEB_ORIGIN + result.next);
      }
      return reply.redirect(db.config.WEB_ORIGIN + "/sso/confirm");
    } catch {
      if (claimed)
        await db.tx(
          async (tx) => {
            await tx.query(
              "UPDATE federation_attempts SET phase='failed',secrets=NULL WHERE id=$1 AND phase NOT IN ('complete','failed')",
              [claimed.a.id],
            );
            await audit(
              tx,
              undefined,
              "auth.sso.rejected",
              claimed.a.id,
              "denied",
              { code: "SSO_SIGN_IN_FAILED" },
              claimed.p.tenant_id,
            );
          },
          undefined,
          true,
        );
      clearBrowser(reply);
      return reply.redirect(
        db.config.WEB_ORIGIN + "/sso/confirm?error=SSO_SIGN_IN_FAILED",
      );
    }
  });
  app.get("/v1/auth/sso/pending", async (req) =>
    db.tx(
      async (tx) => {
        const { a, p } = await pending(tx, req);
        await member(tx, p, a.email);
        return {
          email: a.email,
          provider: p.name,
          workspace: p.tenant_name,
          email_proof_required: true,
        };
      },
      undefined,
      true,
    ),
  );
  app.post("/v1/auth/sso/link/challenge", async (req) => {
    sameWeb(db, req);
    z.object({}).strict().parse(req.body);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const issued = await db.tx(
      async (tx) => {
        const { a, p } = await pending(tx, req);
        await member(tx, p, a.email);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "challenge:user:" + a.email,
        ]);
        const recent = (
          await tx.query(
            "SELECT count(*)::int AS n FROM auth_challenges WHERE email=$1 AND audience='user' AND created_at>now()-interval '1 minute'",
            [a.email],
          )
        ).rows[0].n;
        if (recent >= 2)
          throw new Problem(
            429,
            "RATE_LIMITED",
            "Wait before requesting another code",
          );
        const proof = (
          await tx.query(
            "INSERT INTO auth_challenges(email,audience,purpose,digest,expires_at) VALUES($1,'user','sso_link',$2,now()+interval '10 minutes') RETURNING id",
            [
              a.email,
              hmac(db.config.MASTER_KEY!, `sso:${a.id}:${a.email}:${code}`),
            ],
          )
        ).rows[0];
        await tx.query(
          "UPDATE federation_attempts SET proof_challenge_id=$2 WHERE id=$1",
          [a.id, proof.id],
        );
        return { id: proof.id, email: a.email };
      },
      undefined,
      true,
    );
    await sendMail(
      db,
      issued.email,
      "CopyPaste · Confirm company sign-in",
      `Your company sign-in confirmation code is ${code}. It expires in 10 minutes. Only enter it in CopyPaste.`,
      issued.id,
    );
    return {
      challenge_id: issued.id,
      expires_in: 600,
      delivery: db.config.DEV_MAILBOX ? "local_mailbox" : "email",
    };
  });
  app.post("/v1/auth/sso/link", async (req, reply) => {
    sameWeb(db, req);
    const b = z
      .object({ challenge_id: uuid, code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);
    const result = await db.tx(
      async (tx) => {
        const { a, p } = await pending(tx, req);
        if (a.proof_challenge_id !== b.challenge_id) return null;
        const challenge = (
          await tx.query(
            "SELECT *,expires_at>now() AS valid FROM auth_challenges WHERE id=$1 AND audience='user' AND purpose='sso_link' FOR UPDATE",
            [b.challenge_id],
          )
        ).rows[0];
        if (
          !challenge?.valid ||
          challenge.consumed_at ||
          challenge.attempts >= 5 ||
          challenge.email !== a.email
        )
          return null;
        await tx.query(
          "UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1",
          [challenge.id],
        );
        if (
          !equal(
            challenge.digest,
            hmac(db.config.MASTER_KEY!, `sso:${a.id}:${a.email}:${b.code}`),
          )
        )
          return null;
        const person = await member(tx, p, a.email);
        const other = (
          await tx.query(
            "SELECT user_id FROM federated_identities WHERE connection_id=$1 AND subject=$2",
            [p.id, a.subject],
          )
        ).rows[0];
        if (other && other.user_id !== person.id) return null;
        const previous = (
          await tx.query(
            "SELECT subject,status FROM federated_identities WHERE connection_id=$1 AND user_id=$2",
            [p.id, person.id],
          )
        ).rows[0];
        if (previous?.status === "active" && previous.subject !== a.subject) {
          await revokeFederatedUsers(tx, p.id, person.id);
          person.auth_version = (
            await tx.query("SELECT auth_version FROM users WHERE id=$1", [
              person.id,
            ])
          ).rows[0].auth_version;
        }
        const identity = (
          await tx.query(
            `INSERT INTO federated_identities(connection_id,user_id,subject,revision) VALUES($1,$2,$3,$4)
        ON CONFLICT(connection_id,user_id) DO UPDATE SET subject=EXCLUDED.subject,revision=EXCLUDED.revision,status='active',version=federated_identities.version+1,linked_at=now() RETURNING *`,
            [p.id, person.id, a.subject, p.revision],
          )
        ).rows[0];
        await tx.query(
          "UPDATE auth_challenges SET consumed_at=now() WHERE id=$1",
          [challenge.id],
        );
        await audit(
          tx,
          { id: person.id, audience: "user" },
          "auth.sso.link",
          identity.id,
          "succeeded",
          { connection_id: p.id, revision: p.revision },
          p.tenant_id,
        );
        return issue(tx, db, p, person, identity, a);
      },
      undefined,
      true,
    );
    if (!result)
      throw new Problem(
        401,
        "INVALID_CODE",
        "Invalid or expired company sign-in confirmation",
      );
    clearBrowser(reply);
    setSessionCookie(db, reply, result.value);
    return { redirect: db.config.WEB_ORIGIN + result.next };
  });
  app.get(
    "/v1/me/sso-identities",
    { preHandler: requireUser(db) },
    async (req) =>
      db.tx(
        async (tx) => ({
          items: (
            await tx.query(
              "SELECT i.id,i.status,i.version,i.linked_at,i.last_login_at,c.name,c.login_key,t.name AS tenant_name FROM federated_identities i JOIN sso_connections c ON c.id=i.connection_id JOIN tenants t ON t.id=c.tenant_id WHERE i.user_id=$1 ORDER BY i.linked_at DESC",
              [req.principal.id],
            )
          ).rows,
        }),
        undefined,
        true,
      ),
  );
  app.post(
    "/v1/me/sso-identities/:id/revoke",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id),
        b = z
          .object({ expected_version: z.number().int().positive() })
          .strict()
          .parse(req.body);
      const result = await db.tx(
        async (tx) =>
          replay(
            tx,
            req.principal.id,
            "sso.unlink:" + id,
            key(req),
            b,
            async () => {
              const identity = (
                await tx.query(
                  "SELECT * FROM federated_identities WHERE id=$1 AND user_id=$2",
                  [id, req.principal.id],
                )
              ).rows[0];
              if (!identity)
                throw new Problem(
                  404,
                  "NOT_FOUND",
                  "Company identity not found",
                );
              await connection(tx, identity.connection_id, true);
              const current = (
                await tx.query(
                  "SELECT * FROM federated_identities WHERE id=$1 FOR UPDATE",
                  [id],
                )
              ).rows[0];
              if (current.version !== b.expected_version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Refresh the linked identity",
                );
              if (current.status !== "active")
                throw new Problem(
                  409,
                  "SSO_IDENTITY_REVOKED",
                  "This company identity is already disconnected",
                );
              if (current.status === "active")
                await revokeFederatedUsers(
                  tx,
                  current.connection_id,
                  req.principal.id,
                );
              await audit(tx, req.principal, "auth.sso.unlink", id);
              return { ok: true, signed_out: true };
            },
          ),
        undefined,
        true,
      );
      reply.clearCookie("cp_session", { path: "/v1" });
      return result;
    },
  );
}
