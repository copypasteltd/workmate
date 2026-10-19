import {
  mkdir,
  readFile,
  writeFile,
  lstat,
  readdir,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "./config.js";
import type { Tx } from "./db.js";
import { hash, Problem } from "./lib.js";
export class Storage {
  private s3?: S3Client;
  private sweepCursor?: string;
  constructor(private c: Config) {
    if (c.S3_BUCKET) {
      if (!c.S3_ENDPOINT || !c.S3_ACCESS_KEY || !c.S3_SECRET_KEY)
        throw new Error("Incomplete S3 configuration");
      this.s3 = new S3Client({
        endpoint: c.S3_ENDPOINT,
        region: c.S3_REGION,
        forcePathStyle: true,
        credentials: {
          accessKeyId: c.S3_ACCESS_KEY,
          secretAccessKey: c.S3_SECRET_KEY,
        },
      });
    }
  }
  async put(bytes: Buffer, mime: string) {
    const key = `objects/${randomUUID()}`;
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.c.S3_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: mime,
        }),
      );
    else {
      const file = path.resolve(this.c.DATA_DIR, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
    }
    return key;
  }
  async get(key: string) {
    if (!/^objects\/[a-f\d-]{36}$/.test(key))
      throw new Problem(500, "STORAGE_KEY_INVALID", "Invalid storage key");
    if (this.s3) {
      const r = await this.s3.send(
        new GetObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key }),
      );
      if (!r.Body) throw new Error("Empty object");
      return Buffer.from(await r.Body.transformToByteArray());
    }
    return readFile(path.resolve(this.c.DATA_DIR, key));
  }
  async putFile(file: string, mime: string, size: number) {
    const key = `objects/${randomUUID()}`;
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.c.S3_BUCKET,
          Key: key,
          Body: createReadStream(file),
          ContentType: mime,
          ContentLength: size,
        }),
      );
    else {
      const target = path.resolve(this.c.DATA_DIR, key);
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(
        createReadStream(file),
        createWriteStream(target, { flags: "wx" }),
      );
    }
    return key;
  }
  async stream(key: string): Promise<Readable> {
    this.objectKey(key);
    if (this.s3) {
      const r = await this.s3.send(
        new GetObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key }),
      );
      if (!(r.Body instanceof Readable))
        throw new Error("STORAGE_STREAM_UNAVAILABLE");
      return r.Body;
    }
    const file = await this.ownedPath(key);
    if (!file)
      throw Object.assign(new Error("Object not found"), { code: "ENOENT" });
    return createReadStream(file);
  }
  async remove(key: string) {
    this.objectKey(key);
    if (this.s3) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key }),
      );
      return;
    }
    const file = await this.ownedPath(key);
    if (file)
      await unlink(file).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
  async copy(key: string, mime: string, size: number, sha256: string) {
    const source = await this.stream(key),
      target = `objects/${randomUUID()}`;
    const digest = createHash("sha256");
    const checked = Readable.from(
      (async function* () {
        let bytes = 0;
        for await (const part of source) {
          const chunk = Buffer.from(part);
          bytes += chunk.length;
          if (bytes > size || bytes > 1_073_741_824)
            throw new Error("STORAGE_COPY_SIZE_MISMATCH");
          digest.update(chunk);
          yield chunk;
        }
        if (bytes !== size || digest.digest("hex") !== sha256)
          throw new Error("STORAGE_COPY_INTEGRITY_FAILED");
      })(),
    );
    try {
      if (this.s3)
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.c.S3_BUCKET,
            Key: target,
            Body: checked,
            ContentType: mime,
            ContentLength: size,
          }),
        );
      else {
        const file = path.resolve(this.c.DATA_DIR, target);
        await mkdir(path.dirname(file), { recursive: true });
        await pipeline(checked, createWriteStream(file, { flags: "wx" }));
      }
      return target;
    } catch (e) {
      await this.remove(target).catch(() => {});
      throw e;
    } finally {
      checked.destroy();
      source.destroy();
    }
  }
  /** Only UUID-addressed, owned run trees may be recursively removed. */
  async removeRuntime(tenant: string, task: string) {
    const id = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
    if (!id.test(tenant) || !id.test(task))
      throw new Error("ERASURE_PATH_INVALID");
    await this.removeTree(path.join("runs", tenant, task));
  }
  async removeUpload(id: string) {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id))
      throw new Error("ERASURE_PATH_INVALID");
    await this.removeTree(path.join("uploads", id));
  }
  private async removeTree(relative: string) {
    const directory = await this.ownedPath(relative);
    if (!directory) return;
    const verify = async (p: string): Promise<void> => {
      const stat = await lstat(p);
      if (stat.isSymbolicLink()) throw new Error("ERASURE_LINK_UNSAFE");
      const resolved = await realpath(p);
      if (resolved !== directory && !resolved.startsWith(directory + path.sep))
        throw new Error("ERASURE_PATH_INVALID");
      if (stat.isDirectory())
        for (const entry of await readdir(p)) await verify(path.join(p, entry));
    };
    await verify(directory);
    // Both the resolved absolute target and every descendant were checked to
    // stay in this DATA_DIR/run tree. rm never follows symbolic links.
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 100,
    });
  }
  async orphanCandidates(before: Date, limit = 100) {
    if (this.s3) {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.c.S3_BUCKET,
          Prefix: "objects/",
          MaxKeys: limit,
          ContinuationToken: this.sweepCursor,
        }),
      );
      this.sweepCursor = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
      return (page.Contents ?? [])
        .filter((o) => o.Key && o.LastModified && o.LastModified < before)
        .map((o) => o.Key!)
        .filter((k) => /^objects\/[a-f\d-]{36}$/.test(k));
    }
    const directory = await this.ownedPath("objects");
    if (!directory) return [];
    const names = (await readdir(directory)).sort();
    const remaining = names
      .filter((n) => !this.sweepCursor || n > this.sweepCursor)
      .slice(0, limit);
    this.sweepCursor =
      remaining.length === limit ? remaining.at(-1) : undefined;
    const result: string[] = [];
    for (const n of remaining) {
      if (!/^[a-f\d-]{36}$/.test(n)) continue;
      const stat = await lstat(path.join(directory, n));
      if (!stat.isSymbolicLink() && stat.isFile() && stat.mtime < before)
        result.push(`objects/${n}`);
    }
    return result;
  }
  private objectKey(key: string) {
    if (
      !/^objects\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
        key,
      )
    )
      throw new Problem(500, "STORAGE_KEY_INVALID", "Invalid storage key");
  }
  private async ownedPath(relative: string) {
    const root = path.resolve(this.c.DATA_DIR);
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep))
      throw new Error("ERASURE_PATH_INVALID");
    try {
      const canonicalRoot = await realpath(root);
      let current = root;
      for (const part of path.relative(root, target).split(path.sep)) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("ERASURE_LINK_UNSAFE");
        const resolved = await realpath(current);
        if (!resolved.startsWith(canonicalRoot + path.sep))
          throw new Error("ERASURE_PATH_INVALID");
      }
      return path.join(canonicalRoot, path.relative(root, target));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}
type AssetInput = {
  tenant: string;
  project: string;
  user: string;
  name: string;
  mime: string;
  kind?: string;
  asset?: string;
  expectedVersion?: number;
  conversation?: string;
  metadata?: unknown;
};
export async function saveAsset(
  tx: Tx,
  storage: Storage,
  b: AssetInput & { bytes: Buffer },
) {
  return saveAssetContent(tx, b, b.bytes.length, hash(b.bytes), () =>
    storage.put(b.bytes, b.mime),
  );
}
export async function saveAssetFile(
  tx: Tx,
  storage: Storage,
  b: AssetInput & { file: string; size: number; sha256: string },
) {
  return saveAssetContent(tx, b, b.size, b.sha256, () =>
    storage.putFile(b.file, b.mime, b.size),
  );
}
export async function copyAssetVersion(
  tx: Tx,
  storage: Storage,
  b: AssetInput & { storageKey: string; size: number; sha256: string },
) {
  return saveAssetContent(tx, b, b.size, b.sha256, () =>
    storage.copy(b.storageKey, b.mime, b.size, b.sha256),
  );
}
async function saveAssetContent(
  tx: Tx,
  b: AssetInput,
  size: number,
  digest: string,
  put: () => Promise<string>,
) {
  const metadata = (b.metadata ?? {}) as Record<string, unknown>;
  const mode = (
    await tx.query("SELECT data_mode FROM tenants WHERE id=$1", [b.tenant])
  ).rows[0]?.data_mode;
  metadata.data_mode = mode ?? "configured_services";
  const running = (
    await tx.query(
      "SELECT nullif(current_setting('app.task_id',true),'') AS id",
    )
  ).rows[0].id;
  const sourceTask = running ?? metadata.task_id;
  let privateOwner: string | null = null;
  if (b.conversation) {
    const conversation = (
      await tx.query(
        "SELECT created_by FROM conversations WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND created_by=$4 AND content_state='active'",
        [b.conversation, b.tenant, b.project, b.user],
      )
    ).rows[0];
    if (!conversation)
      throw new Problem(404, "NOT_FOUND", "Conversation not found");
    privateOwner = conversation.created_by;
    metadata.conversation_id = b.conversation;
  }
  if (sourceTask) {
    const task = (
      await tx.query(
        "SELECT private_owner,conversation_id FROM tasks WHERE id=$1 AND tenant_id=$2 AND project_id=$3",
        [sourceTask, b.tenant, b.project],
      )
    ).rows[0];
    if (!task) throw new Problem(404, "NOT_FOUND", "Source task not found");
    privateOwner = task.private_owner;
    metadata.task_id = sourceTask;
    if (task.conversation_id) metadata.conversation_id = task.conversation_id;
  }
  let a: any;
  if (b.asset) {
    a = (
      await tx.query(
        "SELECT * FROM assets WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND state='active' FOR UPDATE",
        [b.tenant, b.project, b.asset],
      )
    ).rows[0];
    if (!a) throw new Problem(404, "NOT_FOUND", "Asset not found");
    if (a.private_owner) {
      const previous = (
        await tx.query(
          "SELECT metadata FROM asset_versions WHERE asset_id=$1 AND version=$2",
          [a.id, a.current_version],
        )
      ).rows[0]?.metadata;
      if (
        previous?.conversation_id &&
        metadata.conversation_id &&
        previous.conversation_id !== metadata.conversation_id
      )
        throw new Problem(
          409,
          "PRIVATE_ARTIFACT_REQUIRED",
          "A private version must stay in its original conversation",
        );
      if (previous?.conversation_id && !metadata.conversation_id)
        metadata.conversation_id = previous.conversation_id;
    }
    if (privateOwner && a.private_owner !== privateOwner)
      throw new Problem(
        409,
        "PRIVATE_ARTIFACT_REQUIRED",
        "Private work must create a private artifact before explicit project publication",
      );
    if (a.current_version !== b.expectedVersion)
      throw new Problem(
        409,
        "VERSION_CONFLICT",
        "Asset changed; refresh before uploading a version",
      );
    a = (
      await tx.query(
        "UPDATE assets SET current_version=current_version+1 WHERE id=$1 RETURNING *",
        [a.id],
      )
    ).rows[0];
  } else
    a = (
      await tx.query(
        "INSERT INTO assets(tenant_id,project_id,name,kind,created_by,private_owner) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [b.tenant, b.project, b.name, b.kind ?? "file", b.user, privateOwner],
      )
    ).rows[0];
  // Object writes are immutable. If the DB transaction rolls back, the unreferenced object is safe for later GC.
  const key = await put();
  const version = (
    await tx.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version,mime_type,bytes,sha256,metadata,created_at",
      [b.tenant, a.id, a.current_version, key, b.mime, size, digest, metadata],
    )
  ).rows[0];
  if (sourceTask)
    await tx.query(
      "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'artifact.ready',$3)",
      [
        b.tenant,
        sourceTask,
        { artifact_id: a.id, asset_version_id: version.id },
      ],
    );
  return { ...a, version };
}
