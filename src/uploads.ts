import type {
  FastifyInstance,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";
import type { Database, Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { z } from "zod";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  open,
  lstat,
  readdir,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import { requireUser, audit } from "./auth.js";
import { projectAccess, key, replay } from "./access.js";
import { Problem, uuid, hash } from "./lib.js";
import { saveAssetFile } from "./storage.js";
const partSize = 4 * 1024 * 1024,
  ordinaryLimit = 100 * 1024 * 1024,
  mediaLimit = 1024 * 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const createInput = z
  .object({
    project_id: uuid,
    filename: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((n) => !/[\x00-\x1f\\/]/.test(n)),
    content_type: z.string().min(1).max(120),
    size_bytes: z.number().int().positive().max(mediaLimit),
    sha256: sha,
    conversation_id: uuid.optional(),
  })
  .strict();
const versionInput = createInput
  .extend({
    asset_id: uuid.optional(),
    expected_version: z.number().int().positive().optional(),
  })
  .refine((b) => !!b.asset_id === !!b.expected_version);
const tenantOf = (req: FastifyRequest) =>
  uuid.parse((req.params as any).tenant ?? req.headers["x-tenant-id"]);
const idOf = (req: FastifyRequest) => uuid.parse((req.params as any).id);
function rootPath(db: Database, id: string) {
  uuid.parse(id);
  const root = path.resolve(db.config.DATA_DIR, "uploads"),
    target = path.resolve(root, id);
  if (path.dirname(target) !== root) throw new Error("UPLOAD_PATH_INVALID");
  return target;
}
async function session(
  tx: Tx,
  req: FastifyRequest,
  tenant: string,
  id: string,
) {
  // Membership first establishes the actor for the upload owner RLS policy.
  const project = (req.params as any).project;
  if (project)
    await projectAccess(
      tx,
      req.principal,
      tenant,
      uuid.parse(project),
      "write",
    );
  else {
    const { tenantAccess } = await import("./access.js");
    await tenantAccess(tx, req.principal, tenant);
  }
  const s = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM upload_sessions WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!s || (project && project !== s.project_id))
    throw new Problem(404, "NOT_FOUND", "Upload not found");
  await projectAccess(tx, req.principal, tenant, s.project_id, "write");
  if (
    s.conversation_id &&
    !(
      await tx.query(
        "SELECT 1 FROM conversations WHERE id=$1 AND created_by=$2 AND project_id=$3 AND content_state='active'",
        [s.conversation_id, req.principal.id, s.project_id],
      )
    ).rowCount
  )
    throw new Problem(404, "NOT_FOUND", "Conversation not found");
  if (!s.valid || s.state === "expired" || s.state === "cancelled")
    throw new Problem(
      410,
      "UPLOAD_EXPIRED",
      "Upload expired or cancelled; start a new upload",
    );
  return s;
}
async function staging(db: Database, id: string) {
  const dir = rootPath(db, id),
    root = path.dirname(dir);
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("UPLOAD_STAGING_UNSAFE");
  await mkdir(dir, { recursive: true });
  if (
    (await lstat(dir)).isSymbolicLink() ||
    path.dirname(await realpath(dir)) !== (await realpath(root))
  )
    throw new Error("UPLOAD_STAGING_UNSAFE");
  return dir;
}
function verifyType(mime: string, head: Buffer) {
  const h = head.toString("hex"),
    t = head.toString("ascii");
  const match =
    mime === "image/png"
      ? h.startsWith("89504e470d0a1a0a")
      : mime === "image/jpeg"
        ? h.startsWith("ffd8ff")
        : mime === "image/webp"
          ? t.startsWith("RIFF") && t.slice(8, 12) === "WEBP"
          : mime === "image/gif"
            ? /^GIF8[79]a/.test(t)
            : mime === "video/mp4" || mime === "video/quicktime"
              ? t.slice(4, 8) === "ftyp"
              : mime === "video/webm" || mime === "audio/webm"
                ? h.startsWith("1a45dfa3")
                : mime === "audio/wav"
                  ? t.startsWith("RIFF") && t.slice(8, 12) === "WAVE"
                  : mime === "audio/mpeg"
                    ? t.startsWith("ID3") ||
                      (head[0] === 255 && (head[1] & 224) === 224)
                    : mime === "audio/mp4"
                      ? t.slice(4, 8) === "ftyp"
                      : mime === "application/pdf"
                        ? t.startsWith("%PDF-")
                        : mime === "application/zip" ||
                            mime ===
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          ? h.startsWith("504b0304") || h.startsWith("504b0506")
                          : mime.startsWith("text/") ||
                              mime === "application/json"
                            ? !head.includes(0)
                            : mime === "application/octet-stream";
  if (!match)
    throw new Problem(
      422,
      "UPLOAD_TYPE_MISMATCH",
      "File bytes do not match the declared supported type",
    );
}
export function registerUploads(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const nested = "/v1/tenants/:tenant/projects/:project/uploads";
  const create: RouteHandlerMethod = async (req, reply) => {
    const tenant = tenantOf(req),
      b = ((req.params as any).tenant ? versionInput : createInput).parse(
        req.body,
      ) as z.infer<typeof versionInput>;
    if (
      (req.params as any).project &&
      b.project_id !== (req.params as any).project
    )
      throw new Problem(404, "NOT_FOUND", "Project not found");
    const media = /^(video|audio)\//.test(b.content_type);
    if (b.size_bytes > (media ? mediaLimit : ordinaryLimit))
      throw new Problem(
        413,
        "FILE_TOO_LARGE",
        media ? "Media limit is 1 GiB" : "File limit is 100 MiB",
      );
    // Validate supported MIME before reserving disk; the actual bytes are
    // validated again at completion. SVG/HTML remain safe attachment downloads.
    if (
      !/^(image\/(png|jpeg|webp|gif)|video\/(mp4|quicktime|webm)|audio\/(wav|mpeg|mp4|webm)|text\/[a-z0-9.+-]+|application\/(json|pdf|zip|octet-stream|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet))$/.test(
        b.content_type,
      )
    )
      throw new Problem(
        415,
        "UPLOAD_TYPE_UNSUPPORTED",
        "Unsupported file type",
      );
    const value = await db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, b.project_id, "write");
      if (
        b.conversation_id &&
        !(
          await tx.query(
            "SELECT 1 FROM conversations WHERE id=$1 AND created_by=$2 AND project_id=$3 AND content_state='active'",
            [b.conversation_id, req.principal.id, b.project_id],
          )
        ).rowCount
      )
        throw new Problem(404, "NOT_FOUND", "Conversation not found");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "upload-quota:" + tenant,
      ]);
      return replay(
        tx,
        req.principal.id,
        "upload.create",
        key(req),
        { tenant, ...b },
        async () => {
          const q = (
            await tx.query(
              "SELECT count(*)::int AS n,coalesce(sum(size_bytes),0)::text AS bytes FROM upload_sessions WHERE state='pending' AND expires_at>now() AND tenant_id=$1",
              [tenant],
            )
          ).rows[0];
          if (q.n >= 10 || Number(q.bytes) + b.size_bytes > 10 * mediaLimit)
            throw new Problem(
              429,
              "UPLOAD_QUOTA",
              "Complete or cancel pending uploads before starting more",
            );
          const s = (
            await tx.query(
              "INSERT INTO upload_sessions(tenant_id,project_id,created_by,filename,mime_type,size_bytes,sha256,asset_id,expected_version,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
              [
                tenant,
                b.project_id,
                req.principal.id,
                b.filename,
                b.content_type,
                b.size_bytes,
                b.sha256,
                b.asset_id ?? null,
                b.expected_version ?? null,
                b.conversation_id ?? null,
              ],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "upload.create",
            s.id,
            "accepted",
            { size_bytes: b.size_bytes },
            tenant,
          );
          return {
            upload_id: s.id,
            upload_url: `${db.config.API_ORIGIN}/v1/tenants/${tenant}/projects/${b.project_id}/uploads/${s.id}/parts`,
            expires_at: s.expires_at,
            part_size_bytes: partSize,
          };
        },
      );
    }, tenant);
    return reply.code(201).send(value);
  };
  app.post("/v1/uploads", { preHandler: requireUser(db) }, create);
  app.post(nested, { preHandler: requireUser(db) }, create);
  const get: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = idOf(req);
    return db.tx(async (tx) => {
      const s = await session(tx, req, tenant, id);
      return {
        upload_id: id,
        state: s.state,
        size_bytes: Number(s.size_bytes),
        sha256: s.sha256,
        part_size_bytes: s.part_size,
        expires_at: s.expires_at,
        parts: (
          await tx.query(
            "SELECT part_index,size_bytes,sha256 FROM upload_parts WHERE upload_id=$1 ORDER BY part_index",
            [id],
          )
        ).rows,
      };
    }, tenant);
  };
  app.get("/v1/uploads/:id", { preHandler: requireUser(db) }, get);
  app.get(nested + "/:id", { preHandler: requireUser(db) }, get);
  const part: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = idOf(req),
      index = z.coerce
        .number()
        .int()
        .nonnegative()
        .max(255)
        .parse((req.params as any).index);
    const b = z
      .object({
        sha256: sha,
        base64: z
          .string()
          .min(1)
          .max(Math.ceil(partSize / 3) * 4)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(req.body);
    const bytes = Buffer.from(b.base64, "base64");
    if (bytes.toString("base64") !== b.base64 || hash(bytes) !== b.sha256)
      throw new Problem(
        422,
        "UPLOAD_PART_CHECKSUM",
        "Part checksum does not match",
      );
    return db.tx(async (tx) => {
      const s = await session(tx, req, tenant, id);
      if (s.state !== "pending")
        throw new Problem(
          409,
          "UPLOAD_ALREADY_COMPLETED",
          "Upload is already completed",
        );
      const count = Math.ceil(Number(s.size_bytes) / s.part_size),
        expected =
          index === count - 1
            ? Number(s.size_bytes) - index * s.part_size
            : s.part_size;
      if (index >= count || bytes.length !== expected)
        throw new Problem(
          422,
          "UPLOAD_PART_SIZE",
          "Part size or index is invalid",
        );
      const old = (
        await tx.query(
          "SELECT * FROM upload_parts WHERE upload_id=$1 AND part_index=$2",
          [id, index],
        )
      ).rows[0];
      if (old && old.sha256 !== b.sha256)
        throw new Problem(
          409,
          "UPLOAD_PART_CONFLICT",
          "This part was already accepted with different bytes",
        );
      const dir = await staging(db, id);
      const tmp = path.join(dir, `${index}.${randomUUID()}.tmp`),
        target = path.join(dir, `${index}.part`);
      // Locking the owner session serializes concurrent retransmission. Even
      // if the process dies before metadata commits, resending repairs disk.
      await writeFile(tmp, bytes, { flag: "wx" });
      await rename(tmp, target);
      await tx.query(
        "INSERT INTO upload_parts(tenant_id,upload_id,part_index,size_bytes,sha256) VALUES($1,$2,$3,$4,$5) ON CONFLICT(upload_id,part_index) DO NOTHING",
        [tenant, id, index, bytes.length, b.sha256],
      );
      return { part_index: index, sha256: b.sha256, size_bytes: bytes.length };
    }, tenant);
  };
  app.post(
    "/v1/uploads/:id/parts/:index",
    { preHandler: requireUser(db) },
    part,
  );
  app.post(nested + "/:id/parts/:index", { preHandler: requireUser(db) }, part);
  const complete: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = idOf(req),
      b = z
        .object({ sha256: sha, size_bytes: z.number().int().positive() })
        .strict()
        .parse(req.body);
    return db.tx(async (tx) => {
      const s = await session(tx, req, tenant, id);
      if (b.sha256 !== s.sha256 || b.size_bytes !== Number(s.size_bytes))
        throw new Problem(
          422,
          "UPLOAD_MANIFEST_MISMATCH",
          "Completion must match the accepted manifest",
        );
      if (s.state === "completed") {
        if (
          !(
            await tx.query(
              "SELECT 1 FROM assets WHERE id=$1 AND state='active'",
              [s.result?.id],
            )
          ).rowCount
        )
          throw new Problem(
            410,
            "CONTENT_DELETED",
            "Uploaded content is unavailable",
          );
        return s.result;
      }
      const parts = (
        await tx.query(
          "SELECT * FROM upload_parts WHERE upload_id=$1 ORDER BY part_index",
          [id],
        )
      ).rows;
      if (parts.length !== Math.ceil(b.size_bytes / s.part_size))
        throw new Problem(
          409,
          "UPLOAD_INCOMPLETE",
          "Some upload parts are missing",
        );
      const dir = await staging(db, id),
        file = path.join(dir, `assembled.${randomUUID()}`),
        out = await open(file, "wx"),
        digest = createHash("sha256");
      let size = 0,
        head = Buffer.alloc(0);
      try {
        try {
          for (const [index, p] of parts.entries()) {
            if (p.part_index !== index)
              throw new Problem(
                409,
                "UPLOAD_INCOMPLETE",
                "A required part is missing",
              );
            const partFile = path.join(dir, `${index}.part`);
            if ((await lstat(partFile)).isSymbolicLink())
              throw new Error("UPLOAD_STAGING_UNSAFE");
            const bytes = await readFile(partFile);
            if (bytes.length !== p.size_bytes || hash(bytes) !== p.sha256)
              throw new Problem(
                422,
                "UPLOAD_PART_CORRUPTED",
                "An accepted part was corrupted; resend it",
              );
            if (!index) head = bytes.subarray(0, 512);
            digest.update(bytes);
            size += bytes.length;
            await out.writeFile(bytes);
          }
          await out.sync();
        } finally {
          await out.close();
        }
        if (size !== b.size_bytes || digest.digest("hex") !== b.sha256)
          throw new Problem(
            422,
            "UPLOAD_CHECKSUM",
            "Whole-file checksum does not match",
          );
        verifyType(s.mime_type, head);
        const asset = await saveAssetFile(tx, storage, {
          tenant,
          project: s.project_id,
          user: req.principal.id,
          name: s.filename,
          mime: s.mime_type,
          file,
          size,
          sha256: b.sha256,
          conversation: s.conversation_id ?? undefined,
          asset: s.asset_id ?? undefined,
          expectedVersion: s.expected_version ?? undefined,
          metadata: {
            upload_id: id,
            source_filename: s.filename,
            checksum_verified: true,
          },
        });
        await tx.query(
          "UPDATE upload_sessions SET state='completed',result=$2 WHERE id=$1",
          [id, asset],
        );
        await audit(
          tx,
          req.principal,
          "upload.complete",
          id,
          "succeeded",
          { asset_id: asset.id, size_bytes: size },
          tenant,
        );
        return asset;
      } finally {
        await unlink(file).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      }
    }, tenant);
  };
  app.post(
    "/v1/uploads/:id/complete",
    { preHandler: requireUser(db) },
    complete,
  );
  app.post(nested + "/:id/complete", { preHandler: requireUser(db) }, complete);
  const cancel: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = idOf(req);
    return db.tx(async (tx) => {
      const s = await session(tx, req, tenant, id);
      if (s.state === "completed")
        throw new Problem(
          409,
          "UPLOAD_ALREADY_COMPLETED",
          "Delete the completed asset instead",
        );
      await tx.query(
        "UPDATE upload_sessions SET state='cancelled',result=NULL WHERE id=$1",
        [id],
      );
      await audit(
        tx,
        req.principal,
        "upload.cancel",
        id,
        "succeeded",
        {},
        tenant,
      );
      return { cancelled: true };
    }, tenant);
  };
  app.delete("/v1/uploads/:id", { preHandler: requireUser(db) }, cancel);
  app.delete(nested + "/:id", { preHandler: requireUser(db) }, cancel);
}
/** Bounded, owned staging cleanup; safe after restart and failed DB commits. */
let stagingCursor = "";
export async function cleanUploadStaging(db: Database) {
  await db.control.query(
    "UPDATE upload_sessions SET state='expired' WHERE state='pending' AND expires_at<=now()",
  );
  const root = path.resolve(db.config.DATA_DIR, "uploads");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const canonical = await realpath(root);
  entries.sort();
  const page = entries.filter((id) => id > stagingCursor).slice(0, 100);
  stagingCursor = page.length === 100 ? page.at(-1)! : "";
  for (const id of page) {
    if (!uuid.safeParse(id).success) continue;
    await db.tx(
      async (tx) => {
        const s = (
          await tx.query(
            "SELECT *,expires_at>now() AS valid FROM upload_sessions WHERE id=$1 FOR UPDATE SKIP LOCKED",
            [id],
          )
        ).rows[0];
        if (
          !s &&
          (await lstat(rootPath(db, id))).mtimeMs > Date.now() - 86_400_000
        )
          return;
        if (s?.state === "pending" && s.valid) return;
        const target = rootPath(db, id),
          st = await lstat(target);
        if (st.isSymbolicLink() || !st.isDirectory())
          throw new Error("UPLOAD_STAGING_UNSAFE");
        if (path.dirname(await realpath(target)) !== canonical)
          throw new Error("UPLOAD_STAGING_UNSAFE");
        for (const entry of await readdir(target)) {
          const st = await lstat(path.join(target, entry));
          if (st.isSymbolicLink() || !st.isFile())
            throw new Error("UPLOAD_STAGING_UNSAFE");
        }
        // Resolved absolute UUID target is a direct child of the owned staging
        // root, contains only files written by this uploader, and is not live.
        await rm(target, {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 100,
        });
        await tx.query(
          "UPDATE upload_sessions SET result=CASE WHEN state='completed' THEN result ELSE NULL END WHERE id=$1",
          [id],
        );
      },
      undefined,
      true,
    );
  }
}
