import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "./config.js";
import type { Tx } from "./db.js";
import { hash, Problem } from "./lib.js";
export class Storage {
  private s3?: S3Client;
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
}
export async function saveAsset(
  tx: Tx,
  storage: Storage,
  b: {
    tenant: string;
    project: string;
    user: string;
    name: string;
    mime: string;
    bytes: Buffer;
    kind?: string;
    asset?: string;
    expectedVersion?: number;
    metadata?: unknown;
  },
) {
  let a: any;
  if (b.asset) {
    a = (
      await tx.query(
        "SELECT * FROM assets WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND state='active' FOR UPDATE",
        [b.tenant, b.project, b.asset],
      )
    ).rows[0];
    if (!a) throw new Problem(404, "NOT_FOUND", "Asset not found");
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
        "INSERT INTO assets(tenant_id,project_id,name,kind,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [b.tenant, b.project, b.name, b.kind ?? "file", b.user],
      )
    ).rows[0];
  // Object writes are immutable. If the DB transaction rolls back, the unreferenced object is safe for later GC.
  const key = await storage.put(b.bytes, b.mime);
  const version = (
    await tx.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version,mime_type,bytes,sha256,metadata,created_at",
      [
        b.tenant,
        a.id,
        a.current_version,
        key,
        b.mime,
        b.bytes.length,
        hash(b.bytes),
        b.metadata ?? {},
      ],
    )
  ).rows[0];
  return { ...a, version };
}
