import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { audit, requireUser, type Principal } from "./auth.js";
import { key, projectAccess, replay } from "./access.js";
import { uuid, hash, canonical, Problem } from "./lib.js";
import { deliveryTaskAccess, deliverySnapshot } from "./business-quality.js";
import { enqueueTask } from "./task-service.js";
import { freezeWorkContext, getAgentVersion, ownConversation, type WorkContext } from "./persistent-work.js";
import { revisionSelection, revisionRequest, revisionInstructions, sameRevisionDelivery, verifyTextAnchor,
  type RevisionSelection, type RevisionBinding } from "./delivery-revision-model.js";

const parameters = z.object({ tenant: uuid, project: uuid, task: uuid });
const base = "/v1/tenants/:tenant/projects/:project/tasks/:task";
const previewLimit = 4 * 1024 * 1024;
export function revisionReference(input: RevisionSelection) {
  return revisionSelection.parse({ source_task_id: input.source_task_id, expected_version: input.expected_version,
    expected_delivery_hash: input.expected_delivery_hash, target: input.target });
}
function terminal(t: any) {
  if (!["succeeded", "failed", "cancelled"].includes(t.status) || t.mode === "plan")
    throw new Problem(409, "REVISION_DELIVERY_REQUIRED", "Choose an existing completed delivery before requesting changes");
}
function special(t: any): string | null {
  return t.agent_group_run_id ? "team" : t.input_context?.solution_trial ? "method"
    : t.input_context?.media_effect ? "effect" : t.input_context?.geo_sample_id ? "observation"
    : t.input_context?.seo_change_task_id ? "seo_change" : t.role_key === "computer-operator" ? "computer" : null;
}
export async function revisionAsset(tx: Tx, t: any, versionId: string) {
  return (await revisionAssets(tx, t, [versionId]))[0];
}
async function revisionAssets(tx: Tx, t: any, versions: string[]) {
  if (!versions.length) return [];
  const rows = (await tx.query(`SELECT a.id AS asset_id,a.name,v.id AS asset_version_id,v.version,v.sha256,
    v.bytes::text,v.mime_type,v.storage_key,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
    WHERE a.tenant_id=$1 AND a.project_id=$2 AND v.id=ANY($3::uuid[]) AND v.metadata->>'task_id'=$4
      AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL FOR SHARE OF a`,
    [t.tenant_id, t.project_id, versions, t.id])).rows;
  const byId = new Map(rows.map(row => [row.asset_version_id, row]));
  if (versions.some(id => !byId.has(id))) throw new Problem(409, "REVISION_ARTIFACT_CHANGED", "This file is no longer part of the current delivery");
  return versions.map(id => byId.get(id)!);
}
export async function revisionBytes(storage: Storage, row: any, limit = previewLimit) {
  if (Number(row.bytes) > limit) throw new Problem(413, "REVISION_PREVIEW_TOO_LARGE", "Download this file to review it, or request changes to the complete file");
  const stream = await storage.stream(row.storage_key), chunks: Buffer[] = []; let size = 0;
  try {
    for await (const part of stream) {
      const b = Buffer.isBuffer(part) ? part : Buffer.from(part); size += b.length;
      if (size > limit || size > Number(row.bytes)) throw new Problem(409, "REVISION_FILE_DAMAGED", "The original file failed its size check");
      chunks.push(b);
    }
  } finally { stream.destroy(); }
  const bytes = Buffer.concat(chunks);
  if (size !== Number(row.bytes) || hash(bytes) !== row.sha256)
    throw new Problem(409, "REVISION_FILE_DAMAGED", "The original file failed its integrity check");
  return bytes;
}
const textMime = (mime: string) => mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime);
function utf8(bytes: Buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Problem(409, "REVISION_TEXT_UNAVAILABLE", "Select a UTF-8 text file or request changes to the complete file"); }
}

/** Used by both cloud admission and the existing authenticated native admission. */
export async function prepareDeliveryRevision(tx: Tx, storage: Storage, actor: Principal, t: any, input: RevisionSelection, instructions: string) {
  terminal(t);
  if (input.source_task_id !== t.id || input.expected_version !== t.version)
    throw new Problem(409, "REVISION_SOURCE_CHANGED", "Reload the original task before requesting changes");
  if (special(t)) throw new Problem(409, "REVISION_SPECIALIST_WORKFLOW_REQUIRED", "Revise this delivery through its original reviewed team, method or specialist workflow");
  const delivery = await deliverySnapshot(tx, t); sameRevisionDelivery(delivery, input.expected_delivery_hash);
  if (!delivery.output_sha256 && !delivery.artifacts.length)
    throw new Problem(409, "REVISION_DELIVERY_REQUIRED", "The original task has no available delivery");
  const target = input.target, rows: any[] = [];
  if ((target.kind === "output" || (target.kind === "text" && !target.asset_version_id)) && !t.output)
    throw new Problem(409, "REVISION_TEXT_UNAVAILABLE", "The original task has no text output");
  if ("asset_version_id" in target && target.asset_version_id) {
    const row = await revisionAsset(tx, t, target.asset_version_id); rows.push(row);
    if (target.kind === "image" && !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"].includes(row.mime_type))
      throw new Problem(400, "REVISION_TARGET_TYPE", "Choose an image for a rectangular selection");
    if (target.kind === "video") {
      if (!row.mime_type.startsWith("video/")) throw new Problem(400, "REVISION_TARGET_TYPE", "Choose a video for a time selection");
      const seconds = Number(row.metadata?.probe?.duration_seconds ?? row.metadata?.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new Problem(409, "REVISION_DURATION_UNAVAILABLE", "Choose the complete video until its verified duration is available");
      if (target.end_ms > Math.round(seconds * 1000))
        throw new Problem(400, "REVISION_INTERVAL_INVALID", "Choose a time interval within the original video");
    }
    if (target.kind === "text") {
      if (!textMime(row.mime_type)) throw new Problem(400, "REVISION_TARGET_TYPE", "Choose a text file for a text selection");
      verifyTextAnchor(utf8(await revisionBytes(storage, row, 1024 * 1024)), target);
    }
  } else if (target.kind === "text") verifyTextAnchor(t.output ?? "", target);
  else if (target.kind === "whole") {
    if (delivery.artifacts.length > 20) throw new Problem(409, "REVISION_SOURCE_LIMIT", "Select one file from this delivery before requesting changes");
    rows.push(...await revisionAssets(tx, t, delivery.artifacts.map((a: any) => a.version_id)));
  }
  if (rows.length > 20) throw new Problem(409, "REVISION_SOURCE_LIMIT", "Select one file from this delivery before requesting changes");
  // Object reads can outlive the request's initial authorization. Recheck before admission.
  await deliveryTaskAccess(tx, actor, t.tenant_id, t.id, t.project_id);
  sameRevisionDelivery(await deliverySnapshot(tx, t), input.expected_delivery_hash);
  const binding: RevisionBinding = { ...input, source_role_key: t.role_key, source_role_hash: t.role_hash };
  return { binding, prompt: revisionInstructions(input, instructions, t.execution_location === "desktop"), dependencies: rows.length ? [{ kind: "file" as const,
    description: "Exact original delivery files explicitly selected for this revision", resource_ids: rows.map(r => r.asset_version_id) }] : [] };
}

/** Bound read only: callers cannot choose another task or a newer asset version. */
export async function readDeliveryRevision(tx: Tx, task: any, offset: number, limit: number) {
  const binding = task.input_context?.delivery_revision as RevisionBinding | undefined;
  if (!binding) throw new Problem(409, "REVISION_SOURCE_UNAVAILABLE", "This task has no selected original delivery");
  const source = (await tx.query("SELECT output FROM tasks WHERE id=$1", [binding.source_task_id])).rows[0];
  if (!source) throw new Problem(409, "REVISION_SOURCE_UNAVAILABLE", "The original delivery is unavailable");
  const characters = Array.from(source.output ?? "");
  const snapshot = (await tx.query("SELECT business_delivery_snapshot($1) AS body", [binding.source_task_id])).rows[0].body;
  sameRevisionDelivery(snapshot, binding.expected_delivery_hash);
  const selected = "asset_version_id" in binding.target && binding.target.asset_version_id;
  const textOnly = binding.target.kind === "output" || (binding.target.kind === "text" && !binding.target.asset_version_id);
  const artifacts = textOnly ? [] : snapshot.artifacts.filter((a: any) => !selected || a.version_id === selected);
  const files = [];
  for (const row of await revisionAssets(tx, { ...task, id: binding.source_task_id }, artifacts.map((a: any) => a.version_id))) {
    files.push({ asset_id: row.asset_id, asset_version_id: row.asset_version_id, version: row.version, sha256: row.sha256,
      name: row.name, mime_type: row.mime_type, bytes: row.bytes }); }
  await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'delivery.revision.read',$3)",
    [task.tenant_id, task.id, { source_task_id: binding.source_task_id, offset, characters: Math.min(limit, Math.max(0, characters.length - offset)) }]);
  return { source_task_id: binding.source_task_id, delivery_hash: binding.expected_delivery_hash, target: binding.target,
    output: characters.slice(offset, offset + limit).join(""), offset, total_characters: characters.length,
    next_offset: offset + limit < characters.length ? offset + limit : null, artifacts: files,
    instructions: "Use exact file version IDs and hashes. Preserve the original delivery and create new files for the requested changes." };
}

export function registerDeliveryRevisions(app: FastifyInstance, db: Database, catalog: Catalog, storage: Storage) {
  app.get(base + "/revision-context", { preHandler: requireUser(db) }, async req => {
    const p = parameters.parse(req.params);
    return db.tx(async tx => {
      const t = await deliveryTaskAccess(tx, req.principal, p.tenant, p.task, p.project); terminal(t);
      const delivery = await deliverySnapshot(tx, t), artifacts = [];
      for (const row of await revisionAssets(tx, t, delivery.artifacts.map((a: any) => a.version_id))) {
        artifacts.push({ asset_id: row.asset_id, asset_version_id: row.asset_version_id, version: row.version, sha256: row.sha256,
          name: row.name, mime_type: row.mime_type, bytes: row.bytes,
          duration_ms: Number(row.metadata?.probe?.duration_seconds ?? row.metadata?.seconds) > 0
            ? Math.round(Number(row.metadata?.probe?.duration_seconds ?? row.metadata?.seconds) * 1000) : null }); }
      let canStart = true;
      try { await projectAccess(tx, req.principal, p.tenant, p.project, "write"); }
      catch (e) { if (!(e instanceof Problem) || e.status !== 403) throw e; canStart = false; }
      const conversation = t.conversation_id ? await ownConversation(tx, req.principal, p.project, t.conversation_id) : null;
      return { source_task_id: t.id, expected_version: t.version, expected_delivery_hash: hash(canonical(delivery)),
        title: t.title, role_key: t.role_key,
        execution_location: t.execution_location, output: t.output ?? "", artifacts,
        conversation_id: conversation?.id ?? null, conversation_version: conversation?.version ?? null,
        can_start: canStart && !conversation?.archived && !special(t), required_workflow: special(t) };
    }, p.tenant);
  });
  app.get(base + "/revision-preview/:version", { preHandler: requireUser(db), config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = parameters.extend({ version: uuid }).parse(req.params), q = z.object({ expected_version: z.coerce.number().int().positive(),
      expected_delivery_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.query);
    const result = await db.tx(async tx => {
      const t = await deliveryTaskAccess(tx, req.principal, p.tenant, p.task, p.project); terminal(t);
      if (t.version !== q.expected_version) throw new Problem(409, "REVISION_SOURCE_CHANGED", "Reload the selected delivery");
      sameRevisionDelivery(await deliverySnapshot(tx, t), q.expected_delivery_hash);
      const row = await revisionAsset(tx, t, p.version);
      if (!textMime(row.mime_type) && !/^(image\/(png|jpeg|webp|gif|avif)|video\/mp4)$/.test(row.mime_type))
        throw new Problem(415, "REVISION_PREVIEW_TYPE", "Download this format to review it, then select the complete file");
      const bytes = await revisionBytes(storage, row, textMime(row.mime_type) ? 1024 * 1024 : previewLimit);
      await deliveryTaskAccess(tx, req.principal, p.tenant, p.task, p.project);
      sameRevisionDelivery(await deliverySnapshot(tx, t), q.expected_delivery_hash);
      return { bytes, mime: row.mime_type };
    }, p.tenant);
    return reply.header("Cache-Control", "no-store").send({ mime_type: result.mime, bytes: result.bytes.length,
      sha256: hash(result.bytes), base64: result.bytes.toString("base64") });
  });
  app.post(base + "/revisions", { preHandler: requireUser(db) }, async (req, reply) => {
    const p = parameters.parse(req.params), input = revisionRequest.parse(req.body), requestKey = key(req);
    const result = await db.tx(async tx => {
      await projectAccess(tx, req.principal, p.tenant, p.project, "write");
      const initial = (await tx.query("SELECT conversation_id FROM tasks WHERE id=$1 AND project_id=$2", [p.task, p.project])).rows[0];
      if (!initial) throw new Problem(404, "NOT_FOUND", "Original task not found");
      const c = initial.conversation_id ? await ownConversation(tx, req.principal, p.project, initial.conversation_id, true) : undefined;
      const t = await deliveryTaskAccess(tx, req.principal, p.tenant, p.task, p.project);
      if (input.source_task_id !== t.id) throw new Problem(400, "REVISION_SOURCE_MISMATCH", "Use the task selected in this path");
      if (t.execution_location !== "cloud") throw new Problem(409, "DESKTOP_LOCAL_EXECUTION_REQUIRED", "Continue this delivery in its original local Desktop session");
      return replay(tx, req.principal.id, "delivery.revision:" + t.id, requestKey, input, async () => {
        if (c && (c.archived || c.version !== input.expected_conversation_version))
          throw new Problem(409, "VERSION_CONFLICT", "Reload the original conversation before submitting changes");
        const prepared = await prepareDeliveryRevision(tx, storage, req.principal, t, revisionReference(input), input.instructions);
        let context: WorkContext | undefined;
        if (t.input_context?.agent_id) { const a = await getAgentVersion(tx, p.project, t.input_context.agent_id, t.input_context.agent_version, true);
          context = await freezeWorkContext(tx, req.principal, p.tenant, p.project, a, c, catalog); }
        const task = await enqueueTask(tx, db, catalog, req.principal, p.tenant, p.project,
          { title: (t.title as string).slice(0, 140) + " · revision", prompt: prepared.prompt, role_key: t.role_key,
            budget_micros: input.budget_micros, parent_id: t.id, mode: "execute", dependencies: prepared.dependencies }, requestKey,
          { context, conversation: c, content_source_task_id: t.id, delivery_revision: prepared.binding });
        if (c) {
          await tx.query("INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) VALUES($1,$2,$3,$4,'user','delegate',$5,$6)",
            [p.tenant, p.project, c.id, randomUUID(), input.instructions, task.id]);
          await tx.query("UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1", [c.id]);
        }
        await audit(tx, req.principal, "delivery.revision.create", task.id, "succeeded", { source_task_id: t.id, delivery_hash: input.expected_delivery_hash, target_kind: input.target.kind }, p.tenant);
        return { task_id: task.id, conversation_id: c?.id ?? null, execution_location: "cloud", status: task.status };
      });
    }, p.tenant);
    return reply.code(201).send(result);
  });
}
