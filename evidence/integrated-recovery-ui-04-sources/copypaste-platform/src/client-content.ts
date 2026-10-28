import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, requireUser, type Principal } from "./auth.js";
import {
  bindings,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { key, tenantAccess, projectAccess } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import {
  clientKind,
  clientNavigation,
  clientContentDocument,
  clientContentAudience,
  fullClientAudience,
  clientAudienceMatches,
  legacyClientContent,
  projectClientContent,
  type ContentSubject,
} from "./client-content-model.js";

const base = "/v1/admin/client-content";
const reason = z.string().trim().min(3).max(1000);
const sampleSchema = z
  .object({
    client: clientKind,
    user_id: uuid.optional(),
    tenant_id: uuid.optional(),
  })
  .strict();
const legacySQL =
  "SELECT id,kind,key,version,body FROM catalog_entries WHERE state='published' AND kind IN ('help','announcement','navigation') AND (kind='navigation' OR coalesce((body->>'enabled')::boolean,true)) ORDER BY created_at DESC,id DESC";
const legacy = async (tx: Tx) => (await tx.query(legacySQL)).rows;
export async function clientContentAuthority(
  tx: Tx,
  p: Principal,
  permission: string,
  sensitive = true,
) {
  await lockAdminAccess(tx);
  await permit(tx, p, permission);
  if (
    (await bindings(tx, p)).some(
      (b) => b.effect === "deny" && b.permissions.includes(permission),
    )
  )
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "This global content operation overlaps an explicit restriction",
    );
  if (sensitive) await requireSensitiveAdmin(tx, p);
}
async function head(tx: Tx, lock = false) {
  return (
    await tx.query(
      `SELECT h.revision,h.publication_id,p.release_id,p.baseline_document,p.baseline_release_id,r.document,r.audience,r.version,r.definition_hash FROM client_content_head h LEFT JOIN client_content_publications p ON p.id=h.publication_id LEFT JOIN client_content_releases r ON r.id=p.release_id WHERE h.singleton ${lock ? "FOR UPDATE OF h" : ""}`,
    )
  ).rows[0];
}
export async function guardLegacyClientContent(
  tx: Tx,
  p: Principal,
  permission: string,
  kind: string,
) {
  if (!["help", "announcement", "navigation"].includes(kind)) return;
  await clientContentAuthority(tx, p, permission);
  if ((await head(tx, true)).publication_id)
    throw new Problem(
      409,
      "VERSIONED_CONTENT_REQUIRED",
      "Use client content drafts, previews and publications for announcements, help and menus",
    );
}
function effective(h: any, subject: ContentSubject, at: number) {
  const selected = clientAudienceMatches(h.audience, subject);
  return {
    items: projectClientContent(
      selected ? h.document : h.baseline_document,
      subject,
      selected ? h.release_id : (h.baseline_release_id ?? "legacy"),
      at,
    ),
    source: selected ? "rollout" : "baseline",
    release_id: selected ? h.release_id : h.baseline_release_id,
  };
}
export async function publicClientContent(tx: Tx) {
  const h = await head(tx);
  if (!h.publication_id) return { items: await legacy(tx) };
  // Anonymous and pre-upgrade clients never receive a targeted audience's copy.
  const document = fullClientAudience(h.audience)
    ? h.document
    : h.baseline_document;
  return {
    items: projectClientContent(
      document,
      { client: "web" },
      fullClientAudience(h.audience)
        ? h.release_id
        : (h.baseline_release_id ?? "legacy"),
    ),
  };
}
async function release(tx: Tx, id: string) {
  const r = (
    await tx.query("SELECT * FROM client_content_releases WHERE id=$1", [id])
  ).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Content version not found");
  return r;
}
function releaseDTO(r: any) {
  return {
    id: r.id,
    version: r.version,
    document: r.document,
    audience: r.audience,
    definition_hash: r.definition_hash,
    reason: r.reason,
    created_by: r.created_by,
    created_at: r.created_at,
  };
}
async function validateSubjects(
  tx: Tx,
  p: Principal,
  users: string[],
  tenants: string[],
) {
  if (users.length) {
    await clientContentAuthority(tx, p, "admin.users.read", false);
    if (
      (
        await tx.query(
          "SELECT id FROM users WHERE id=ANY($1::uuid[]) AND status='active'",
          [users],
        )
      ).rowCount !== users.length
    )
      throw new Problem(
        409,
        "CONTENT_AUDIENCE_UNAVAILABLE",
        "Select active users from the current directory",
      );
  }
  if (tenants.length) {
    await clientContentAuthority(tx, p, "admin.tenants.read", false);
    if (
      (
        await tx.query(
          "SELECT id FROM tenants WHERE id=ANY($1::uuid[]) AND status='active'",
          [tenants],
        )
      ).rowCount !== tenants.length
    )
      throw new Problem(
        409,
        "CONTENT_AUDIENCE_UNAVAILABLE",
        "Select active workspaces from the current directory",
      );
  }
}
async function baseline(tx: Tx, h: any, r: any, action: string) {
  if (action === "rollback") {
    const old = (
      await tx.query(
        "SELECT baseline_document,baseline_release_id FROM client_content_publications WHERE release_id=$1 ORDER BY revision DESC LIMIT 1",
        [r.id],
      )
    ).rows[0];
    if (!old)
      throw new Problem(
        409,
        "CONTENT_ROLLBACK_UNAVAILABLE",
        "Rollback requires a previously published version",
      );
    return old;
  }
  if (
    h.publication_id &&
    !fullClientAudience(h.audience) &&
    !fullClientAudience(r.audience)
  )
    throw new Problem(
      409,
      "CONTENT_ROLLOUT_ACTIVE",
      "Publish a version to everyone or roll back the current rollout before starting another targeted release",
    );
  return h.publication_id
    ? {
        baseline_document: fullClientAudience(h.audience)
          ? h.document
          : h.baseline_document,
        baseline_release_id: fullClientAudience(h.audience)
          ? h.release_id
          : h.baseline_release_id,
      }
    : {
        baseline_document: legacyClientContent(await legacy(tx)),
        baseline_release_id: null,
      };
}
export function registerClientContent(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/client-content",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const q = z
        .object({ client: clientKind, project_id: uuid.optional() })
        .strict()
        .parse(req.query);
      const tenant =
        req.headers["x-tenant-id"] === undefined
          ? undefined
          : uuid.parse(req.headers["x-tenant-id"]);
      if (q.project_id && !tenant)
        throw new Problem(
          400,
          "WORKSPACE_REQUIRED",
          "Select a workspace for this project",
        );
      reply.header("Cache-Control", "private, no-store");
      return db.tx(
        async (tx) => {
          if (q.project_id)
            await projectAccess(tx, req.principal, tenant!, q.project_id);
          else if (tenant) await tenantAccess(tx, req.principal, tenant);
          const h = await head(tx),
            now = Date.now();
          return {
            ...(h.publication_id
              ? effective(
                  h,
                  {
                    client: q.client,
                    user_id: req.principal.id,
                    tenant_id: tenant,
                  },
                  now,
                )
              : {
                  items: await legacy(tx),
                  source: "legacy",
                  release_id: null,
                }),
            revision: h.revision,
            publication_id: h.publication_id,
            server_time: new Date(now).toISOString(),
          };
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.get(base, { preHandler: requireAdmin(db) }, async (req, reply) => {
    const q = z
      .object({
        before_version: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict()
      .parse(req.query);
    reply.header("Cache-Control", "private, no-store");
    return db.tx(
      async (tx) => {
        await clientContentAuthority(
          tx,
          req.principal,
          "admin.catalog.read",
          false,
        );
        const h = await head(tx);
        const rows = (
          await tx.query(
            "SELECT r.*, (SELECT count(*)::int FROM client_content_publications p WHERE p.release_id=r.id) AS publications FROM client_content_releases r WHERE ($1::integer IS NULL OR version<$1) ORDER BY version DESC LIMIT $2",
            [q.before_version ?? null, q.limit + 1],
          )
        ).rows;
        return {
          revision: h.revision,
          publication_id: h.publication_id,
          current_release_id: h.release_id ?? null,
          rollout_active: !!h.publication_id && !fullClientAudience(h.audience),
          items: rows
            .slice(0, q.limit)
            .map((r) => ({ ...releaseDTO(r), publications: r.publications })),
          next_before_version:
            rows.length > q.limit ? rows[q.limit - 1].version : null,
          navigation: clientNavigation,
          initial_document: h.publication_id
            ? h.document
            : legacyClientContent(await legacy(tx)),
        };
      },
      undefined,
      true,
    );
  });
  app.get(
    base + "/publications",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const q = z
        .object({
          before_revision: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        })
        .strict()
        .parse(req.query);
      reply.header("Cache-Control", "private, no-store");
      return db.tx(
        async (tx) => {
          await clientContentAuthority(
            tx,
            req.principal,
            "admin.catalog.read",
            false,
          );
          const items = (
            await tx.query(
              "SELECT p.id,p.revision,p.release_id,r.version,r.definition_hash,p.action,p.previous_publication_id,p.created_by,p.reason,p.created_at FROM client_content_publications p JOIN client_content_releases r ON r.id=p.release_id WHERE ($1::integer IS NULL OR p.revision<$1) ORDER BY p.revision DESC LIMIT $2",
              [q.before_revision ?? null, q.limit + 1],
            )
          ).rows;
          return {
            items: items.slice(0, q.limit),
            next_before_revision:
              items.length > q.limit ? items[q.limit - 1].revision : null,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(base, { preHandler: requireAdmin(db) }, async (req) => {
    const b = z
        .object({
          document: clientContentDocument,
          audience: clientContentAudience,
          reason,
        })
        .strict()
        .parse(req.body),
      requestKey = key(req);
    return db.tx(
      async (tx) => {
        await clientContentAuthority(tx, req.principal, "admin.catalog.draft");
        await validateSubjects(
          tx,
          req.principal,
          b.audience.user_ids,
          b.audience.tenant_ids,
        );
        await head(tx, true);
        const requestHash = hash(canonical(b));
        const previous = (
          await tx.query(
            "SELECT * FROM client_content_releases WHERE created_by=$1 AND idempotency_key=$2",
            [req.principal.id, requestKey],
          )
        ).rows[0];
        if (previous) {
          if (previous.request_hash !== requestHash)
            throw new Problem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "This request key belongs to a different content draft",
            );
          return releaseDTO(previous);
        }
        const definition = canonical({
          document: b.document,
          audience: b.audience,
        });
        const r = (
          await tx.query(
            "INSERT INTO client_content_releases(version,document,audience,canonical_definition,definition_hash,reason,created_by,idempotency_key,request_hash) SELECT coalesce(max(version),0)+1,$1,$2,$3,$4,$5,$6,$7,$8 FROM client_content_releases RETURNING *",
            [
              b.document,
              b.audience,
              definition,
              hash(definition),
              b.reason,
              req.principal.id,
              requestKey,
              requestHash,
            ],
          )
        ).rows[0];
        await audit(
          tx,
          req.principal,
          "admin.client_content.draft",
          r.id,
          "succeeded",
          { definition_hash: r.definition_hash, version: r.version },
        );
        return releaseDTO(r);
      },
      undefined,
      true,
    );
  });
  app.post(
    base + "/:id/previews",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = z
          .object({
            action: z.enum(["publish", "rollback"]),
            reason,
            sample: sampleSchema,
          })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          await clientContentAuthority(
            tx,
            req.principal,
            "admin.catalog." + b.action,
          );
          await clientContentAuthority(
            tx,
            req.principal,
            "admin.catalog.read",
            false,
          );
          await validateSubjects(
            tx,
            req.principal,
            b.sample.user_id ? [b.sample.user_id] : [],
            b.sample.tenant_id ? [b.sample.tenant_id] : [],
          );
          if (
            b.sample.user_id &&
            b.sample.tenant_id &&
            !(
              await tx.query(
                "SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id=$2 AND status='active'",
                [b.sample.user_id, b.sample.tenant_id],
              )
            ).rowCount
          )
            throw new Problem(
              409,
              "CONTENT_SAMPLE_UNAVAILABLE",
              "The preview user is not an active member of this workspace",
            );
          const h = await head(tx, true),
            r = await release(tx, id),
            fallback = await baseline(tx, h, r, b.action),
            now = Date.now();
          await validateSubjects(
            tx,
            req.principal,
            r.audience.user_ids,
            r.audience.tenant_ids,
          );
          const before = h.publication_id
            ? effective(h, b.sample, now)
            : {
                items: projectClientContent(
                  fallback.baseline_document,
                  b.sample,
                  "legacy",
                  now,
                ),
                source: "legacy",
                release_id: null,
              };
          const after = effective(
            { ...r, release_id: r.id, ...fallback },
            b.sample,
            now,
          );
          const comparison = {
            before,
            after,
            sample_selected: clientAudienceMatches(r.audience, b.sample),
            evaluated_at: new Date(now).toISOString(),
          };
          const v = (
            await tx.query(
              "INSERT INTO client_content_previews(release_id,action,expected_revision,previous_publication_id,baseline_document,baseline_release_id,created_by,auth_version,session_id,reason,sample,comparison) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,expires_at",
              [
                id,
                b.action,
                h.revision,
                h.publication_id,
                fallback.baseline_document,
                fallback.baseline_release_id,
                req.principal.id,
                req.principal.authVersion,
                req.principal.sessionId,
                b.reason,
                b.sample,
                comparison,
              ],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.client_content.preview",
            v.id,
            "succeeded",
            {
              action: b.action,
              release_id: id,
              definition_hash: r.definition_hash,
              expected_revision: h.revision,
            },
          );
          return {
            ...v,
            ...comparison,
            revision: h.revision,
            release: releaseDTO(r),
            action: b.action,
            reason: b.reason,
          };
        },
        undefined,
        true,
      );
    },
  );
  for (const action of ["publish", "rollback"] as const)
    app.post(
      base + "/" + action,
      { preHandler: requireAdmin(db) },
      async (req) => {
        const b = z.object({ preview_id: uuid }).strict().parse(req.body);
        return db.tx(
          async (tx) => {
            await clientContentAuthority(
              tx,
              req.principal,
              "admin.catalog." + action,
            );
            await clientContentAuthority(
              tx,
              req.principal,
              "admin.catalog.read",
              false,
            );
            const h = await head(tx, true),
              v = (
                await tx.query(
                  "SELECT *,expires_at>clock_timestamp() AS fresh FROM client_content_previews WHERE id=$1",
                  [b.preview_id],
                )
              ).rows[0];
            if (
              !v ||
              v.created_by !== req.principal.id ||
              v.session_id !== req.principal.sessionId ||
              v.auth_version !== req.principal.authVersion ||
              v.action !== action
            )
              throw new Problem(
                409,
                "CONTENT_PREVIEW_REQUIRED",
                "Create a new preview in this signed-in session",
              );
            const prior = (
              await tx.query(
                "SELECT id,revision,release_id,action FROM client_content_publications WHERE preview_id=$1",
                [v.id],
              )
            ).rows[0];
            if (prior) return { ...prior, replay: true };
            if (!v.fresh)
              throw new Problem(
                409,
                "CONTENT_PREVIEW_EXPIRED",
                "The preview expired; review the current content again",
              );
            if (
              h.revision !== v.expected_revision ||
              h.publication_id !== v.previous_publication_id
            )
              throw new Problem(
                409,
                "CONTENT_PREVIEW_STALE",
                "Another administrator published content; review the new differences",
              );
            const r = await release(tx, v.release_id),
              fallback = await baseline(tx, h, r, action);
            await validateSubjects(
              tx,
              req.principal,
              r.audience.user_ids,
              r.audience.tenant_ids,
            );
            if (
              canonical(fallback) !==
              canonical({
                baseline_document: v.baseline_document,
                baseline_release_id: v.baseline_release_id,
              })
            )
              throw new Problem(
                409,
                "CONTENT_PREVIEW_STALE",
                "The fallback content changed; create a new preview",
              );
            const p = (
              await tx.query(
                "INSERT INTO client_content_publications(preview_id,release_id,previous_publication_id,revision,action,baseline_document,baseline_release_id,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,revision,release_id,action",
                [
                  v.id,
                  r.id,
                  h.publication_id,
                  h.revision + 1,
                  action,
                  v.baseline_document,
                  v.baseline_release_id,
                  req.principal.id,
                  v.reason,
                ],
              )
            ).rows[0];
            await tx.query(
              "UPDATE client_content_head SET revision=$1,publication_id=$2 WHERE singleton",
              [p.revision, p.id],
            );
            await audit(
              tx,
              req.principal,
              "admin.client_content." + action,
              p.id,
              "succeeded",
              {
                release_id: r.id,
                definition_hash: r.definition_hash,
                revision: p.revision,
                preview_id: v.id,
              },
            );
            return { ...p, replay: false };
          },
          undefined,
          true,
        );
      },
    );
}
