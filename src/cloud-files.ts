import type {
  FastifyInstance,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit, requireUser } from "./auth.js";
import {
  eraseReplayContent,
  key,
  projectAccess,
  replay,
  tenantAccess,
} from "./access.js";
import { hash, Problem, uuid } from "./lib.js";
import { copyAssetVersion, type Storage } from "./storage.js";
import { DocumentPreviews } from "./document-preview.js";

const nodeName = z
  .string()
  .transform((v) => v.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(180)
      .refine(
        (v) => !/[\x00-\x1f\x7f/\\]/.test(v) && ![".", ".."].includes(v),
        "Use a file name without path separators",
      ),
  );
const pagination = {
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
};
const fields =
  "n.*,v.asset_id,v.version AS source_version,v.mime_type,v.bytes,v.sha256,a.state AS asset_state,a.name AS source_name,v.erased_at";
const joins =
  "workspace_nodes n LEFT JOIN asset_versions v ON v.id=n.asset_version_id LEFT JOIN assets a ON a.id=v.asset_id";
export const cloudNode = (n: any) => ({
  id: n.id,
  workspace_id: n.workspace_id,
  project_id: n.project_id,
  ...(n.parent_id ? { parent_id: n.parent_id } : {}),
  name: n.name,
  kind: n.kind,
  ...(n.asset_version_id ? { asset_version_id: n.asset_version_id } : {}),
  version: n.version,
  updated_at: n.updated_at,
  ...(n.root_kind ? { root_kind: n.root_kind } : {}),
  ...(n.kind === "file"
    ? {
        reference_state:
          n.erased_at || n.asset_state === "deleted"
            ? "deleted"
            : n.asset_state === "active"
              ? "ready"
              : n.reference_state === "deleted"
                ? "deleted"
                : "unavailable",
      }
    : {}),
});
const workspace = (w: any) => ({
  id: w.id,
  project_id: w.project_id,
  ...(w.conversation_id ? { conversation_id: w.conversation_id } : {}),
  kind: w.kind,
  version: w.version,
});
const tenantOf = (req: FastifyRequest) =>
  uuid.parse((req.params as any).tenant ?? req.headers["x-tenant-id"]);
async function access(
  tx: Tx,
  p: Principal,
  tenant: string,
  id: string,
  write = false,
  project?: string,
) {
  await tenantAccess(tx, p, tenant);
  const w = (
    await tx.query(
      "SELECT * FROM cloud_workspaces WHERE id=$1 AND content_state='active'",
      [id],
    )
  ).rows[0];
  if (!w || (project && w.project_id !== project))
    throw new Problem(404, "NOT_FOUND", "Cloud workspace not found");
  await projectAccess(tx, p, tenant, w.project_id, write ? "write" : "read");
  if (
    w.conversation_id &&
    !(
      await tx.query(
        "SELECT 1 FROM conversations WHERE id=$1 AND created_by=$2 AND content_state='active'",
        [w.conversation_id, p.id],
      )
    ).rowCount
  )
    throw new Problem(404, "NOT_FOUND", "Cloud workspace not found");
  if (write)
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "cloudtree:" + w.project_id,
    ]);
  return w;
}
async function node(tx: Tx, id: string) {
  return (
    await tx.query(
      `SELECT ${fields} FROM ${joins} WHERE n.id=$1 AND n.content_state='active'`,
      [id],
    )
  ).rows[0];
}
async function checkReference(tx: Tx, w: any, id?: string) {
  if (!id) return;
  const r = (
    await tx.query(
      "SELECT a.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.id=$1 AND a.state='active' AND v.erased_at IS NULL",
      [id],
    )
  ).rows[0];
  if (
    !r ||
    r.project_id !== w.project_id ||
    r.tenant_id !== w.tenant_id ||
    (r.private_owner && r.private_owner !== w.private_owner)
  )
    throw new Problem(404, "NOT_FOUND", "Authorized file version not found");
}
async function checkParent(tx: Tx, w: any, id?: string | null) {
  if (!id) return;
  const p = (
    await tx.query(
      "SELECT 1 FROM workspace_nodes WHERE id=$1 AND workspace_id=$2 AND kind='directory' AND content_state='active'",
      [id, w.id],
    )
  ).rows[0];
  if (!p)
    throw new Problem(
      404,
      "NOT_FOUND",
      "Folder not found in this cloud workspace",
    );
}
export async function eraseWorkspaceNode(tx: Tx, id: string) {
  const row = (
    await tx.query("SELECT * FROM workspace_nodes WHERE id=$1", [id])
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "File entry not found");
  if (row.root_kind)
    throw new Problem(
      409,
      "WORKSPACE_ROOT_PROTECTED",
      "Keep the default workspace folders; remove their contents individually",
    );
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "cloudtree:" + row.project_id,
  ]);
  await tx.query("SELECT set_config('app.erasing_content','true',true)");
  const ids = (
    await tx.query(
      `WITH RECURSIVE tree AS (SELECT id FROM workspace_nodes WHERE id=$1 UNION ALL SELECT n.id FROM workspace_nodes n JOIN tree t ON n.parent_id=t.id WHERE n.content_state<>'deleted') SELECT id FROM tree`,
      [id],
    )
  ).rows.map((r) => r.id);
  await eraseReplayContent(tx, ids);
  await tx.query(
    "UPDATE workspace_nodes SET content_state='deleted',version=version+1,moderation_version=moderation_version+1,updated_at=now() WHERE id=ANY($1::uuid[]) AND content_state<>'deleted'",
    [ids],
  );
  const j = (
    await tx.query(
      "SELECT * FROM deletion_jobs WHERE target_type='workspace_nodes' AND target_id=$1",
      [id],
    )
  ).rows[0];
  return { id: j.id, state: j.state, exceptions: j.exceptions };
}

export function registerCloudFiles(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const documentPreviews=new DocumentPreviews();
  app.addHook("onClose",async()=>{await documentPreviews.close();});
  const documentPreview: RouteHandlerMethod=async(req,reply)=>{
    const tenant=tenantOf(req),route=req.params as any,id=uuid.parse(route.node_id??route.asset),q=z.object({
      asset_version_id:uuid,page:z.coerce.number().int().min(1).max(400).default(1),describe:z.enum(["true"]).optional(),
    }).strict().parse(req.query);
    const authorize=async()=>{await requireUser(db)(req);return db.tx(async tx=>{
      if(route.asset){
        await projectAccess(tx,req.principal,tenant,uuid.parse(route.project));
        const source=(await tx.query(`SELECT a.id AS asset_id,a.name AS source_name,v.id AS asset_version_id,v.version AS source_version,
          v.version,v.storage_key,v.mime_type,v.bytes,v.sha256 FROM assets a JOIN asset_versions v ON v.asset_id=a.id
          WHERE a.id=$1 AND a.project_id=$2 AND a.tenant_id=$3 AND a.state='active' AND v.id=$4 AND v.erased_at IS NULL`,[id,route.project,tenant,q.asset_version_id])).rows[0];
        if(!source)throw new Problem(404,"NOT_FOUND","Authorized file version not found");return source;
      }
      await tenantAccess(tx,req.principal,tenant);const n=await node(tx,id);
      if(!n)throw new Problem(404,"NOT_FOUND","File entry not found");
      await access(tx,req.principal,tenant,n.workspace_id,false,(req.params as any).project);
      if(n.kind!=="file")throw new Problem(400,"FILE_REQUIRED","Choose a file to preview");
      if(n.asset_state!=="active"||n.erased_at)throw new Problem(410,"REFERENCE_UNAVAILABLE","The source file is unavailable");
      if(n.asset_version_id!==q.asset_version_id)throw new Problem(409,"VERSION_CONFLICT","This reference changed. Reopen the file before previewing it.");
      const v=(await tx.query("SELECT storage_key FROM asset_versions WHERE id=$1 AND erased_at IS NULL",[q.asset_version_id])).rows[0];
      if(!v)throw new Problem(410,"REFERENCE_UNAVAILABLE","The source file is unavailable");return {...n,storage_key:v.storage_key};
    },tenant);};
    const n=await authorize(),capability=await documentPreviews.capability(n.mime_type,n.source_name,Number(n.bytes));
    const descriptor={asset_id:n.asset_id,asset_version_id:q.asset_version_id,source_version:n.source_version,sha256:n.sha256,
      content_type:n.mime_type,size_bytes:Number(n.bytes),document_preview:capability??{available:false,state:"unsupported"}};
    reply.header("Cache-Control","private, no-store");
    if(!capability?.available||q.describe){await authorize();return descriptor;}
    const stop=new AbortController(),closed=()=>{if(!reply.raw.writableEnded)stop.abort();};reply.raw.once("close",closed);
    try{
      const bytes=await storage.get(n.storage_key);
      if(bytes.length!==Number(n.bytes)||hash(bytes)!==n.sha256)throw new Problem(422,"REFERENCE_INTEGRITY_FAILED","The file checksum does not match its pinned version");
      const page=await documentPreviews.render(req.principal.id,q.asset_version_id+":"+n.sha256,bytes,q.page,stop.signal);
      const current=await authorize();if(current.version!==n.version||current.sha256!==n.sha256)throw new Problem(409,"VERSION_CONFLICT","This file entry changed. Reopen it before previewing.");
      return {...descriptor,...page};
    }finally{reply.raw.removeListener("close",closed);}
  };
  app.get("/v1/tenants/:tenant/projects/:project/cloud-nodes/:node_id/document-preview",{preHandler:requireUser(db)},documentPreview);
  app.get("/v1/workspace-nodes/:node_id/document-preview",{preHandler:requireUser(db)},documentPreview);
  app.get("/v1/tenants/:tenant/projects/:project/assets/:asset/document-preview",{preHandler:requireUser(db)},documentPreview);
  const list: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      q = z
        .object({
          project_id: uuid.optional(),
          conversation_id: uuid.optional(),
          ...pagination,
        })
        .strict()
        .parse(req.query);
    return db.tx(async (tx) => {
      const membership = await tenantAccess(tx, req.principal, tenant);
      if (
        q.project_id &&
        (req.params as any).project &&
        q.project_id !== (req.params as any).project
      )
        throw new Problem(404, "NOT_FOUND", "Cloud workspace not found");
      const project = q.project_id ?? (req.params as any).project;
      if (project) await projectAccess(tx, req.principal, tenant, project);
      const rows = (
        await tx.query(
          `SELECT w.* FROM cloud_workspaces w JOIN projects p ON p.id=w.project_id WHERE w.content_state='active' AND NOT p.archived AND ($1::uuid IS NULL OR w.project_id=$1) AND ($2::uuid IS NULL OR w.conversation_id=$2) AND ($3::uuid IS NULL OR w.id>$3) AND ($4::boolean OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=w.project_id AND m.user_id=$5)) AND (w.conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=w.conversation_id AND c.content_state='active')) ORDER BY w.id LIMIT $6`,
          [
            project ?? null,
            q.conversation_id ?? null,
            q.cursor ?? null,
            ["owner", "admin"].includes(membership.role),
            req.principal.id,
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit).map(workspace),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  };
  const browse: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).workspace_id),
      q = z
        .object({
          parent_id: uuid.optional(),
          project_id: uuid.optional(),
          q: z.string().trim().max(150).optional(),
          kind: z.enum(["directory", "file"]).optional(),
          ...pagination,
        })
        .strict()
        .parse(req.query);
    return db.tx(async (tx) => {
      const w = await access(
        tx,
        req.principal,
        tenant,
        id,
        false,
        (req.params as any).project,
      );
      if (q.project_id && q.project_id !== w.project_id)
        throw new Problem(404, "NOT_FOUND", "Cloud workspace not found");
      const search = !!q.q;
      if (q.parent_id) await checkParent(tx, { id }, q.parent_id);
      const rows = (
        await tx.query(
          `SELECT ${fields} FROM ${joins} WHERE n.workspace_id=$1 AND n.content_state='active' AND ($2::boolean OR n.parent_id IS NOT DISTINCT FROM $3::uuid) AND ($4::text IS NULL OR n.name ILIKE $4 ESCAPE '\\') AND ($5::uuid IS NULL OR n.id>$5) AND ($7::text IS NULL OR n.kind=$7) ORDER BY n.id LIMIT $6`,
          [
            id,
            search,
            q.parent_id ?? null,
            search ? "%" + q.q!.replace(/[\\%_]/g, "\\$&") + "%" : null,
            q.cursor ?? null,
            q.limit + 1,
            q.kind ?? null,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit).map(cloudNode),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  };
  const create: RouteHandlerMethod = async (req, reply) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).workspace_id),
      b = z
        .object({
          parent_id: uuid.optional(),
          name: nodeName,
          kind: z.enum(["directory", "file"]),
          asset_version_id: uuid.optional(),
        })
        .strict()
        .superRefine((v, c) => {
          if ((v.kind === "file") !== !!v.asset_version_id)
            c.addIssue({
              code: "custom",
              message: "Only files require an exact asset version",
            });
        })
        .parse(req.body);
    const result = await db.tx(async (tx) => {
      const w = await access(
        tx,
        req.principal,
        tenant,
        id,
        true,
        (req.params as any).project,
      );
      return replay(
        tx,
        req.principal.id,
        "cloud.node.create",
        key(req),
        { tenant, id, ...b },
        async () => {
          await checkParent(tx, w, b.parent_id);
          await checkReference(tx, w, b.asset_version_id);
          const n = (
            await tx.query(
              "INSERT INTO workspace_nodes(tenant_id,project_id,workspace_id,parent_id,name,kind,asset_version_id,private_owner,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
              [
                tenant,
                w.project_id,
                id,
                b.parent_id ?? null,
                b.name,
                b.kind,
                b.asset_version_id ?? null,
                w.private_owner,
                req.principal.id,
              ],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "cloud.node.create",
            n.id,
            "succeeded",
            { workspace_id: id, kind: b.kind },
            tenant,
          );
          return cloudNode(await node(tx, n.id));
        },
      );
    }, tenant);
    return reply.code(201).send(result);
  };
  const change: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).node_id),
      b = z
        .object({
          expected_version: z.number().int().positive(),
          name: nodeName.optional(),
          parent_id: uuid.nullable().optional(),
          asset_version_id: uuid.optional(),
        })
        .strict()
        .refine(
          (v) =>
            v.name !== undefined ||
            v.parent_id !== undefined ||
            v.asset_version_id !== undefined,
          "Choose a name, folder or file version",
        )
        .parse(req.body);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      let n = await node(tx, id);
      if (!n) throw new Problem(404, "NOT_FOUND", "File entry not found");
      const w = await access(
        tx,
        req.principal,
        tenant,
        n.workspace_id,
        true,
        (req.params as any).project,
      );
      return replay(
        tx,
        req.principal.id,
        "cloud.node.update",
        key(req),
        { tenant, id, ...b },
        async () => {
          n = await node(tx, id);
          if (!n) throw new Problem(404, "NOT_FOUND", "File entry not found");
          if (n.version !== b.expected_version)
            throw new Problem(
              409,
              "VERSION_CONFLICT",
              "This file entry changed; refresh before editing",
            );
          if (n.root_kind)
            throw new Problem(
              409,
              "WORKSPACE_ROOT_PROTECTED",
              "Default folders retain their names and scope",
            );
          if (b.asset_version_id && n.kind !== "file")
            throw new Problem(
              400,
              "FILE_REQUIRED",
              "A folder cannot reference a file version",
            );
          await checkParent(tx, w, b.parent_id);
          await checkReference(tx, w, b.asset_version_id);
          await tx.query(
            "UPDATE workspace_nodes SET name=$2,parent_id=$3,asset_version_id=$4,version=version+1,moderation_version=moderation_version+1,updated_at=now() WHERE id=$1",
            [
              id,
              b.name ?? n.name,
              b.parent_id === undefined ? n.parent_id : b.parent_id,
              b.asset_version_id ?? n.asset_version_id,
            ],
          );
          await audit(
            tx,
            req.principal,
            "cloud.node.update",
            id,
            "succeeded",
            { workspace_id: w.id },
            tenant,
          );
          return cloudNode(await node(tx, id));
        },
      );
    }, tenant);
  };
  const remove: RouteHandlerMethod = async (req, reply) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).node_id);
    const result = await db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const n = await node(tx, id);
      if (!n) throw new Problem(404, "NOT_FOUND", "File entry not found");
      await access(
        tx,
        req.principal,
        tenant,
        n.workspace_id,
        true,
        (req.params as any).project,
      );
      return replay(
        tx,
        req.principal.id,
        "cloud.node.delete",
        key(req),
        { tenant, id },
        async () => {
          const result = await eraseWorkspaceNode(tx, id);
          await audit(
            tx,
            req.principal,
            "cloud.node.delete",
            id,
            "accepted",
            { deletion_id: result.id },
            tenant,
          );
          return result;
        },
      );
    }, tenant);
    return reply.code(202).send(result);
  };
  const reference: RouteHandlerMethod = async (req) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).node_id);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const n = await node(tx, id);
      if (!n) throw new Problem(404, "NOT_FOUND", "File entry not found");
      await access(
        tx,
        req.principal,
        tenant,
        n.workspace_id,
        false,
        (req.params as any).project,
      );
      if (n.kind !== "file")
        throw new Problem(400, "FILE_REQUIRED", "Choose a file to preview");
      if (n.asset_state !== "active" || n.erased_at)
        throw new Problem(
          410,
          "REFERENCE_UNAVAILABLE",
          "The source file was removed or is no longer available",
        );
      let preview: Record<string, unknown> = {};
      const text =
        /^(text\/|application\/json)/.test(n.mime_type) &&
        Number(n.bytes) <= 100_000;
      const image =
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          n.mime_type,
        ) && Number(n.bytes) <= 2_000_000;
      if (text || image) {
        const v = (
          await tx.query(
            "SELECT storage_key FROM asset_versions WHERE id=$1 AND erased_at IS NULL",
            [n.asset_version_id],
          )
        ).rows[0];
        if (!v)
          throw new Problem(
            410,
            "REFERENCE_UNAVAILABLE",
            "The source file is unavailable",
          );
        const bytes = await storage.get(v.storage_key);
        if (hash(bytes) !== n.sha256)
          throw new Problem(
            422,
            "REFERENCE_INTEGRITY_FAILED",
            "The file checksum does not match its pinned version",
          );
        preview = text
          ? { text: bytes.toString("utf8") }
          : {
              preview_image: {
                content_type: n.mime_type,
                base64: bytes.toString("base64"),
              },
            };
      }
      return {
        node: cloudNode(n),
        asset_id: n.asset_id,
        asset_version_id: n.asset_version_id,
        source_version: n.source_version,
        content_type: n.mime_type,
        size_bytes: Number(n.bytes),
        sha256: n.sha256,
        ...preview,
      };
    }, tenant);
  };
  const promote: RouteHandlerMethod = async (req, reply) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).artifact_id),
      b = z
        .object({
          workspace_id: uuid,
          parent_id: uuid.optional(),
          base_asset_version_id: uuid,
          sharing_scope: z.literal("project"),
        })
        .strict()
        .parse(req.body);
    const result = await db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const a = (
        await tx.query(
          "SELECT a.*,v.id AS vid,v.storage_key,v.mime_type,v.bytes,v.sha256 FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.id=$1 AND v.id=$2 AND a.state='active' AND v.erased_at IS NULL FOR UPDATE OF a",
          [id, b.base_asset_version_id],
        )
      ).rows[0];
      if (!a || (a.private_owner && a.private_owner !== req.principal.id))
        throw new Problem(404, "NOT_FOUND", "Artifact version not found");
      const w = await access(
        tx,
        req.principal,
        tenant,
        b.workspace_id,
        true,
        (req.params as any).project,
      );
      if (w.kind !== "project" || w.project_id !== a.project_id)
        throw new Problem(
          409,
          "WORKSPACE_SCOPE_INVALID",
          "Publish to the shared workspace in the same project",
        );
      return replay(
        tx,
        req.principal.id,
        "cloud.artifact.promote",
        key(req),
        { tenant, id, ...b },
        async () => {
          await checkParent(tx, w, b.parent_id);
          const copy = await copyAssetVersion(tx, storage, {
            tenant,
            project: w.project_id,
            user: req.principal.id,
            name: a.name,
            mime: a.mime_type,
            kind: "published_deliverable",
            storageKey: a.storage_key,
            size: Number(a.bytes),
            sha256: a.sha256,
          });
          const indexed = (
            await tx.query(
              "SELECT * FROM workspace_nodes WHERE asset_version_id=$1 AND workspace_id=$2",
              [copy.version.id, w.id],
            )
          ).rows[0];
          if (b.parent_id)
            await tx.query(
              "UPDATE workspace_nodes SET parent_id=$2,version=version+1,updated_at=now() WHERE id=$1",
              [indexed.id, b.parent_id],
            );
          await audit(
            tx,
            req.principal,
            "cloud.artifact.promote",
            copy.id,
            "succeeded",
            {
              source_asset_id: a.id,
              source_version_id: a.vid,
              node_id: indexed.id,
            },
            tenant,
          );
          return cloudNode(await node(tx, indexed.id));
        },
      );
    }, tenant);
    return reply.code(201).send(result);
  };
  const auth = { preHandler: requireUser(db) },
    base = "/v1/tenants/:tenant/projects/:project";
  app.get("/v1/workspaces", auth, list);
  app.get(base + "/cloud-workspaces", auth, list);
  for (const prefix of [
    "/v1/workspaces/:workspace_id",
    base + "/cloud-workspaces/:workspace_id",
  ]) {
    app.get(prefix + "/nodes", auth, browse);
    app.post(prefix + "/nodes", auth, create);
  }
  for (const prefix of [
    "/v1/workspace-nodes/:node_id",
    base + "/cloud-nodes/:node_id",
  ]) {
    app.patch(prefix, auth, change);
    app.delete(prefix, auth, remove);
    app.get(prefix + "/reference", auth, reference);
  }
  app.post("/v1/artifacts/:artifact_id/promotions", auth, promote);
  app.post(base + "/assets/:artifact_id/promotions", auth, promote);
}
