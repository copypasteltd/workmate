import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  realpath,
  readFile,
  writeFile,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { clientContentAuthority } from "./client-content.js";
import { key, replay } from "./access.js";
import { Problem, uuid } from "./lib.js";
import {
  parseUpdateKeys,
  verifyUpdateEnvelope,
  updateCanonical,
  updateChunkBytes,
  type UpdateEnvelope,
  UpdateError,
} from "./desktop-update-contract.js";
import { desktopUpdateEnvelopeSchema } from "./desktop-update-schema.js";

const prefix = "/v1/admin/desktop-updates";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const channel = z.enum(["stable", "preview"]);
const reason = z.string().trim().min(5).max(1000);
export const desktopUpdateStage = z
  .object({ envelope: desktopUpdateEnvelopeSchema, reason })
  .strict();
export const desktopUpdatePart = z
  .object({
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(updateChunkBytes / 3) * 4),
    sha256: sha,
  })
  .strict();
export const desktopUpdatePublication = z
  .object({
    expected_revision: z.number().int().min(0).max(2147483646),
    reason,
    confirmed_sha256: sha,
  })
  .strict();
const digest = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
async function verifyStoredInstaller(
  file: string,
  bytes: number,
  expected: string,
) {
  const handle = await open(file, "r");
  const stat = await handle.stat();
  if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes) {
    await handle.close();
    throw new Problem(
      409,
      "UPDATE_STORAGE_CHANGED",
      "Installer storage changed",
    );
  }
  const hash = createHash("sha256");
  let total = 0;
  for await (const chunk of handle.createReadStream({ autoClose: true })) {
    total += chunk.length;
    if (total > bytes)
      throw new Problem(
        409,
        "UPDATE_STORAGE_CHANGED",
        "Installer storage changed",
      );
    hash.update(chunk);
  }
  if (total !== bytes || hash.digest("hex") !== expected)
    throw new Problem(
      409,
      "UPDATE_STORAGE_CHANGED",
      "Installer storage changed",
    );
}
async function root(db: Database) {
  await mkdir(db.config.DATA_DIR, { recursive: true });
  const base = await realpath(db.config.DATA_DIR),
    dir = path.join(base, "desktop-updates");
  await mkdir(dir, { recursive: true });
  if ((await lstat(dir)).isSymbolicLink() || (await realpath(dir)) !== dir)
    throw new Problem(
      503,
      "UPDATE_STORAGE_UNAVAILABLE",
      "Release storage is unavailable",
    );
  return dir;
}
async function ownedFile(dir: string, name: string) {
  if (!/^(?:[a-f0-9]{64}\.exe|[a-f0-9-]{36}-\d+\.part)$/.test(name))
    throw new Error("UPDATE_STORAGE_PATH_INVALID");
  const file = path.join(dir, name);
  try {
    if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink())
      throw new Error("UPDATE_STORAGE_PATH_INVALID");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  return file;
}
async function authority(
  tx: Tx,
  p: Principal,
  action: "read" | "stage" | "publish",
) {
  await clientContentAuthority(tx, p, "admin.desktop_updates." + action);
}
export function registerDesktopUpdates(app: FastifyInstance, db: Database) {
  const keys = parseUpdateKeys(db.config.DESKTOP_UPDATE_PUBLIC_KEYS);
  const check = (value: unknown) => {
    try {
      return verifyUpdateEnvelope(value, keys, {
        minimumSequence: db.config.DESKTOP_UPDATE_MIN_SEQUENCE,
      });
    } catch (error) {
      if (error instanceof UpdateError)
        throw new Problem(
          400,
          error.code,
          "The signed release cannot be used. Check the configured trust keys, sequence and validity.",
        );
      throw error;
    }
  };
  const row = async (tx: Tx, id: string) => {
    const value = (
      await tx.query(
        "SELECT * FROM desktop_update_releases WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!value) throw new Problem(404, "NOT_FOUND", "Release not found");
    return value;
  };
  app.get(prefix, { preHandler: requireAdmin(db) }, async (req) => {
    const q = z
      .object({
        channel: channel.default("stable"),
        before_sequence: z.coerce.number().int().positive().optional(),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        await authority(tx, req.principal, "read");
        const head = (
          await tx.query(
            "SELECT * FROM desktop_update_heads WHERE channel=$1",
            [q.channel],
          )
        ).rows[0];
        const items = (
          await tx.query(
            `SELECT r.*,coalesce((SELECT jsonb_agg(p.part ORDER BY p.part) FROM desktop_update_parts p WHERE p.release_id=r.id),'[]') AS uploaded_parts FROM desktop_update_releases r WHERE channel=$1 AND ($2::bigint IS NULL OR sequence<$2) ORDER BY sequence DESC LIMIT 21`,
            [q.channel, q.before_sequence ?? null],
          )
        ).rows;
        const history = (
          await tx.query(
            "SELECT * FROM desktop_update_publications WHERE channel=$1 ORDER BY revision DESC LIMIT 20",
            [q.channel],
          )
        ).rows;
        await audit(
          tx,
          req.principal,
          "admin.desktop_updates.read",
          q.channel,
          "succeeded",
          { count: Math.min(items.length, 20) },
        );
        return {
          head,
          items: items.slice(0, 20),
          next_sequence: items.length > 20 ? Number(items[19].sequence) : null,
          history,
          trust_configured: Object.keys(keys).length > 0,
          chunk_bytes: updateChunkBytes,
        };
      },
      undefined,
      true,
    );
  });
  app.post(prefix, { preHandler: requireAdmin(db) }, async (req) => {
    const b = desktopUpdateStage.parse(req.body),
      envelope = check(b.envelope),
      p = envelope.payload;
    return db.tx(
      async (tx) => {
        await authority(tx, req.principal, "stage");
        return replay(
          tx,
          req.principal.id,
          "desktop-update.stage",
          key(req),
          b,
          async () => {
            const head = (
              await tx.query(
                "SELECT h.revision,r.sequence FROM desktop_update_heads h LEFT JOIN desktop_update_releases r ON r.id=h.release_id WHERE h.channel=$1 FOR UPDATE OF h",
                [p.channel],
              )
            ).rows[0];
            if (p.sequence <= Number(head.sequence ?? 0))
              throw new Problem(
                409,
                "UPDATE_SEQUENCE_CHANGED",
                "Use a new, higher signed sequence",
              );
            const result = await tx.query(
              "INSERT INTO desktop_update_releases(channel,sequence,envelope,envelope_sha256,state,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *",
              [
                p.channel,
                p.sequence,
                envelope,
                digest(updateCanonical(envelope)),
                p.release ? "uploading" : "ready",
                req.principal.id,
              ],
            );
            if (!result.rowCount)
              throw new Problem(
                409,
                "UPDATE_SEQUENCE_EXISTS",
                "This release sequence was already staged",
              );
            const value = result.rows[0];
            await audit(
              tx,
              req.principal,
              "admin.desktop_updates.stage",
              value.id,
              "succeeded",
              {
                channel: p.channel,
                sequence: p.sequence,
                envelope_sha256: value.envelope_sha256,
                reason: b.reason,
              },
            );
            return value;
          },
        );
      },
      undefined,
      true,
    );
  });
  app.put(
    prefix + "/:id/parts/:part",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        index = z.coerce
          .number()
          .int()
          .min(0)
          .max(511)
          .parse((req.params as any).part),
        b = desktopUpdatePart.parse(req.body);
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          b.base64,
        )
      )
        throw new Problem(400, "UPDATE_PART_INVALID", "Use canonical base64");
      const bytes = Buffer.from(b.base64, "base64");
      if (bytes.toString("base64") !== b.base64 || digest(bytes) !== b.sha256)
        throw new Problem(400, "UPDATE_PART_INVALID", "Part checksum differs");
      return db.tx(
        async (tx) => {
          await authority(tx, req.principal, "stage");
          const r = await row(tx, id),
            e = check(r.envelope),
            release = e.payload.release;
          if (!release || r.state !== "uploading")
            throw new Problem(
              409,
              "UPDATE_UPLOAD_CLOSED",
              "This upload is closed",
            );
          const expected = Math.min(
            updateChunkBytes,
            release.bytes - index * updateChunkBytes,
          );
          if (expected < 1 || bytes.length !== expected)
            throw new Problem(
              400,
              "UPDATE_PART_INVALID",
              "Part size or index differs",
            );
          const prior = (
            await tx.query(
              "SELECT * FROM desktop_update_parts WHERE release_id=$1 AND part=$2",
              [id, index],
            )
          ).rows[0];
          if (prior && prior.sha256 !== b.sha256)
            throw new Problem(
              409,
              "UPDATE_PART_CONFLICT",
              "A different part was already accepted",
            );
          const dir = await root(db),
            file = await ownedFile(dir, id + "-" + index + ".part");
          if (prior) {
            if (digest(await readFile(file)) !== prior.sha256)
              throw new Problem(
                409,
                "UPDATE_STORAGE_CHANGED",
                "Stored part changed",
              );
            return { part: index, sha256: b.sha256 };
          }
          try {
            await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
          } catch (error: any) {
            if (
              error.code !== "EEXIST" ||
              digest(await readFile(file)) !== b.sha256
            )
              throw error;
          }
          await tx.query(
            "INSERT INTO desktop_update_parts(release_id,part,sha256,bytes) VALUES($1,$2,$3,$4)",
            [id, index, b.sha256, bytes.length],
          );
          await audit(
            tx,
            req.principal,
            "admin.desktop_updates.part",
            id,
            "succeeded",
            { part: index, sha256: b.sha256, bytes: bytes.length },
          );
          return { part: index, sha256: b.sha256 };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    prefix + "/:id/finalize",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      z.object({}).strict().parse(req.body);
      return db.tx(
        async (tx) => {
          await authority(tx, req.principal, "stage");
          const r = await row(tx, id),
            e = check(r.envelope),
            release = e.payload.release;
          if (r.state !== "uploading")
            return { id, state: r.state, version: r.version };
          if (!release)
            throw new Problem(
              409,
              "UPDATE_UPLOAD_CLOSED",
              "This release has no artifact",
            );
          const parts = (
            await tx.query(
              "SELECT * FROM desktop_update_parts WHERE release_id=$1 ORDER BY part",
              [id],
            )
          ).rows;
          if (parts.length !== Math.ceil(release.bytes / updateChunkBytes))
            throw new Problem(
              409,
              "UPDATE_UPLOAD_INCOMPLETE",
              "Upload every part first",
            );
          const dir = await root(db),
            target = await ownedFile(dir, release.sha256 + ".exe"),
            temporary = path.join(dir, ".assembling-" + randomUUID());
          const out = await open(temporary, "wx", 0o600);
          let total = 0;
          const hash = createHash("sha256");
          try {
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].part !== i)
                throw new Problem(
                  409,
                  "UPDATE_UPLOAD_INCOMPLETE",
                  "Part index differs",
                );
              const data = await readFile(
                await ownedFile(dir, id + "-" + i + ".part"),
              );
              if (
                digest(data) !== parts[i].sha256 ||
                data.length !== parts[i].bytes
              )
                throw new Problem(
                  409,
                  "UPDATE_STORAGE_CHANGED",
                  "Stored part changed",
                );
              if (i === 0 && (data[0] !== 77 || data[1] !== 90))
                throw new Problem(
                  400,
                  "UPDATE_INSTALLER_INVALID",
                  "A Windows installer is required",
                );
              hash.update(data);
              total += data.length;
              await out.writeFile(data);
            }
            if (
              total !== release.bytes ||
              hash.digest("hex") !== release.sha256
            )
              throw new Problem(
                409,
                "UPDATE_ARTIFACT_MISMATCH",
                "Installer hash or length differs from the signed release",
              );
            await out.sync();
            await out.close();
            try {
              await verifyStoredInstaller(
                target,
                release.bytes,
                release.sha256,
              );
            } catch (error: any) {
              if (error.code !== "ENOENT") throw error;
              await rename(temporary, target);
            }
          } finally {
            await out.close().catch(() => {});
            await unlink(temporary).catch(() => {});
          }
          await tx.query(
            "UPDATE desktop_update_releases SET state='ready',version=version+1 WHERE id=$1",
            [id],
          );
          await audit(
            tx,
            req.principal,
            "admin.desktop_updates.finalize",
            id,
            "succeeded",
            { sha256: release.sha256, bytes: release.bytes },
          );
          return { id, state: "ready", version: r.version + 1 };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    prefix + "/:id/publish",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = desktopUpdatePublication.parse(req.body);
      return db.tx(
        async (tx) => {
          await authority(tx, req.principal, "publish");
          return replay(
            tx,
            req.principal.id,
            "desktop-update.publish:" + id,
            key(req),
            b,
            async () => {
              // Always lock the channel before its release, matching stage's lock order.
              const located = (
                await tx.query(
                  "SELECT channel FROM desktop_update_releases WHERE id=$1",
                  [id],
                )
              ).rows[0];
              if (!located)
                throw new Problem(404, "NOT_FOUND", "Release not found");
              const head = (
                await tx.query(
                  "SELECT h.*,r.sequence FROM desktop_update_heads h LEFT JOIN desktop_update_releases r ON r.id=h.release_id WHERE h.channel=$1 FOR UPDATE OF h",
                  [located.channel],
                )
              ).rows[0];
              const r = await row(tx, id),
                e = check(r.envelope);
              if (
                r.state !== "ready" ||
                b.expected_revision !== head.revision ||
                e.payload.sequence <= Number(head.sequence ?? 0) ||
                r.envelope_sha256 !== b.confirmed_sha256
              )
                throw new Problem(
                  409,
                  "UPDATE_PUBLICATION_CHANGED",
                  "Refresh and confirm the exact signed release",
                );
              if (e.payload.action === "rollback") {
                const prior = (
                  await tx.query(
                    "SELECT 1 FROM desktop_update_publications p JOIN desktop_update_releases r ON r.id=p.release_id WHERE p.channel=$1 AND r.envelope->'payload'->'release'=$2::jsonb LIMIT 1",
                    [r.channel, JSON.stringify(e.payload.release)],
                  )
                ).rowCount;
                if (!prior)
                  throw new Problem(
                    409,
                    "UPDATE_ROLLBACK_UNPUBLISHED",
                    "Rollback must select an exact previously published artifact and notes",
                  );
              }
              if (e.payload.release) {
                const file = await ownedFile(
                  await root(db),
                  e.payload.release.sha256 + ".exe",
                );
                await verifyStoredInstaller(
                  file,
                  e.payload.release.bytes,
                  e.payload.release.sha256,
                );
              }
              const revision = head.revision + 1;
              await tx.query(
                "INSERT INTO desktop_update_publications(channel,revision,release_id,previous_release_id,published_by,reason) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  r.channel,
                  revision,
                  id,
                  head.release_id,
                  req.principal.id,
                  b.reason,
                ],
              );
              await tx.query(
                "UPDATE desktop_update_heads SET revision=$2,release_id=$3,updated_at=now() WHERE channel=$1",
                [r.channel, revision, id],
              );
              await tx.query(
                "UPDATE desktop_update_releases SET state='published',version=version+1 WHERE id=$1",
                [id],
              );
              await audit(
                tx,
                req.principal,
                "admin.desktop_updates.publish",
                id,
                "succeeded",
                {
                  action: e.payload.action,
                  channel: r.channel,
                  sequence: e.payload.sequence,
                  revision,
                  envelope_sha256: r.envelope_sha256,
                  reason: b.reason,
                },
              );
              return {
                id,
                revision,
                channel: r.channel,
                sequence: e.payload.sequence,
              };
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  app.get("/v1/public/desktop-updates/:channel", async (req, reply) => {
    const c = channel.parse((req.params as any).channel);
    reply.header("Cache-Control", "no-store");
    const value = (
      await db.control.query(
        "SELECT r.envelope FROM desktop_update_heads h JOIN desktop_update_releases r ON r.id=h.release_id WHERE h.channel=$1",
        [c],
      )
    ).rows[0];
    if (!value) return { envelope: null };
    try {
      return { envelope: check(value.envelope) };
    } catch {
      throw new Problem(
        503,
        "UPDATE_RELEASE_UNAVAILABLE",
        "No current trusted release is available",
      );
    }
  });
  app.get(
    "/v1/public/desktop-updates/artifacts/:sha256",
    async (req, reply) => {
      const hash = sha.parse((req.params as any).sha256);
      const choices = (
        await db.control.query(
          "SELECT r.envelope FROM desktop_update_heads h JOIN desktop_update_releases r ON r.id=h.release_id WHERE r.envelope->'payload'->'release'->>'sha256'=$1",
          [hash],
        )
      ).rows;
      let envelope: UpdateEnvelope | undefined;
      for (const choice of choices) {
        try {
          envelope = check(choice.envelope);
          break;
        } catch {}
      }
      if (!envelope?.payload.release)
        throw new Problem(
          404,
          "UPDATE_RELEASE_UNAVAILABLE",
          "Installer is no longer published",
        );
      const file = await open(
          await ownedFile(await root(db), hash + ".exe"),
          "r",
        ),
        stat = await file.stat();
      if (!stat.isFile() || stat.size !== envelope.payload.release.bytes) {
        await file.close();
        throw new Problem(
          503,
          "UPDATE_STORAGE_CHANGED",
          "Installer is unavailable",
        );
      }
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", stat.size)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .header(
          "Content-Disposition",
          'attachment; filename="CopyPaste-Setup.exe"',
        );
      return reply.send(file.createReadStream({ autoClose: true }));
    },
  );
}
