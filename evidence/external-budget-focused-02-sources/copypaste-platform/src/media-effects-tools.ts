import { zipSync } from "fflate";
import type { Tx } from "./db.js";
import { saveAsset, type Storage } from "./storage.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  recordTaskSourceRead,
  recordTaskContentRead,
  assertTaskContentSources,
} from "./task-content-sources.js";
import { taskPrivateAssetScopeSQL } from "./task-private-asset-scope.js";
import {
  effectDigest,
  effectsCatalog,
  frozenEffect,
  parseEffect,
  type EffectRequest,
} from "./media-effects-model.js";
import {
  renderMediaEffect,
  checkEffectsCancellation,
  type EffectSource,
} from "./media-effects-render.js";

const unavailable = () =>
  new Problem(
    404,
    "NOT_FOUND",
    "The authorized fixed effect source is unavailable",
  );
export async function listEffectSources(
  tx: Tx,
  t: any,
  input: { after_id?: string; limit: number },
) {
  const rows = (
    await tx.query(
      `SELECT a.id AS asset_id,a.name,v.id AS asset_version_id,v.sha256,v.mime_type,v.bytes,v.version
    FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
    WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
      AND ($3::uuid IS NULL OR v.id>$3) AND v.mime_type IN ('image/png','video/mp4') AND v.bytes<=33554432
      AND task_asset_version_sources_available(v.id)
      AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5 AND ${taskPrivateAssetScopeSQL(6, 8)}))
    ORDER BY v.id LIMIT $7`,
      [
        t.tenant_id,
        t.project_id,
        input.after_id ?? null,
        t.created_by,
        t.private_owner ?? null,
        t.conversation_id ?? null,
        input.limit + 1,
        t.id ?? null,
      ],
    )
  ).rows;
  const page = rows.slice(0, input.limit);
  if (t.id)
    for (const v of page)
      await recordTaskSourceRead(
        tx,
        t,
        "asset_version",
        v.asset_version_id,
        v.asset_version_id,
        v.sha256,
      );
  return {
    items: page,
    next_after_id:
      rows.length > input.limit ? page.at(-1)!.asset_version_id : null,
    source_policy: effectsCatalog().source_policy,
  };
}
export async function loadEffectSources(
  tx: Tx,
  storage: Storage,
  t: any,
  input: EffectRequest,
): Promise<EffectSource[]> {
  const result: EffectSource[] = [];
  for (const ref of input.sources) {
    const v = (
      await tx.query(
        `SELECT v.* FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
        AND (a.private_owner IS NULL OR (a.private_owner=$4 AND a.private_owner=$5 AND ${taskPrivateAssetScopeSQL(6, 7)}))
        AND task_asset_version_sources_available(v.id) FOR SHARE OF a NOWAIT`,
        [
          ref.asset_version_id,
          t.tenant_id,
          t.project_id,
          t.created_by,
          t.private_owner ?? null,
          t.conversation_id ?? null,
          t.id ?? null,
        ],
      )
    ).rows[0];
    if (!v) throw unavailable();
    if (v.sha256 !== ref.sha256)
      throw new Problem(
        409,
        "EFFECT_SOURCE_CHANGED",
        "Select the exact source version and digest again",
      );
    if (
      !["image/png", "video/mp4"].includes(v.mime_type) ||
      Number(v.bytes) > 32 * 1024 * 1024
    )
      throw new Problem(
        413,
        "EFFECT_SOURCE_LIMIT",
        effectsCatalog().source_policy,
      );
    const bytes = await storage.get(v.storage_key);
    if (bytes.length !== Number(v.bytes) || hash(bytes) !== ref.sha256)
      throw new Problem(
        409,
        "EFFECT_SOURCE_INTEGRITY",
        "The source no longer matches its saved bytes",
      );
    if (t.id && v.metadata.task_id !== t.id)
      await recordTaskContentRead(tx, t, "asset_version", v.id, v.id, v.sha256);
    result.push({ ...ref, mime_type: v.mime_type, bytes });
  }
  return result;
}
async function completedEffect(tx: Tx, t: any, digest: string) {
  const old = (
    await tx.query(
      "SELECT result FROM task_tool_receipts WHERE task_id=$1 AND tool_name='effect_render' AND result->>'request_sha256'=$2 ORDER BY created_at LIMIT 1",
      [t.id, digest],
    )
  ).rows[0]?.result;
  if (!old) return null;
  const ids = old.files.map((f: any) => f.asset_version_id);
  if (
    ids.length !== 4 ||
    (
      await tx.query(
        `SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=ANY($1::uuid[]) AND v.metadata->>'task_id'=$2
      AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`,
        [ids, t.id],
      )
    ).rowCount !== ids.length
  )
    throw new Problem(
      409,
      "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
      "A completed effect output is unavailable; do not regenerate it automatically",
    );
  return old;
}
export async function finalizeReviewedEffect(tx: Tx, t: any) {
  const input = frozenEffect(t);
  if (!input) return null;
  const result = await completedEffect(tx, t, effectDigest(input));
  if (
    !result ||
    result.probe?.full_decode !== true ||
    result.provider_calls !== 0
  )
    throw new Problem(
      409,
      "EFFECT_DELIVERY_INCOMPLETE",
      "No validated effect delivery was produced",
    );
  return "Completed the reviewed media effect. The actual silent MP4, PNG preview, immutable source JSON and ZIP are available in the task files. Original audio is omitted. Rendering added no model request or AI fee.";
}
export async function renderTaskEffect(
  tx: Tx,
  storage: Storage,
  t: any,
  value: EffectRequest,
  dataDir: string,
  signal?: AbortSignal,
) {
  const input = parseEffect(value),
    digest = effectDigest(input),
    approved = frozenEffect(t);
  if (approved && digest !== effectDigest(approved))
    throw new Problem(
      409,
      "EFFECT_APPROVAL_MISMATCH",
      "Use exactly the customer's reviewed effect parameters and source versions",
    );
  const sources = await loadEffectSources(tx, storage, t, input),
    prior = await completedEffect(tx, t, digest);
  if (prior) return prior;
  const result = await renderMediaEffect(
    input,
    sources,
    dataDir,
    signal,
    t.input_context?.media_effect?.renderer_profile,
  );
  await assertTaskContentSources(tx, t);
  checkEffectsCancellation(signal);
  const body = {
    schema: "copypaste-media-effect-delivery-1",
    request: input,
    request_sha256: digest,
    catalog_sha256: result.catalog_sha256,
    definition_sha256: effectsCatalog().items.find(
      (e) => e.id === input.effect_id,
    )!.definition_sha256,
    renderer_profile: result.profile,
    source_info: result.source_info,
    probe: result.probe,
    data_mode: t.data_mode,
    provider_calls: 0,
    ai_generation: false,
    audio: "omitted",
    files: [
      {
        name: "effect.mp4",
        sha256: result.output_sha256,
        bytes: result.video.length,
      },
      {
        name: "preview.png",
        sha256: result.preview_sha256,
        bytes: result.preview.length,
      },
    ],
  };
  const source = Buffer.from(canonical(body), "utf8"),
    zip = Buffer.from(
      zipSync(
        {
          "effect.mp4": result.video,
          "preview.png": result.preview,
          "effect.source.json": source,
        },
        { level: 0 },
      ),
    );
  const files = [];
  for (const f of [
    { name: "effect.mp4", mime: "video/mp4", bytes: result.video },
    { name: "preview.png", mime: "image/png", bytes: result.preview },
    { name: "effect.source.json", mime: "application/json", bytes: source },
    { name: "effect.delivery.zip", mime: "application/zip", bytes: zip },
  ]) {
    const saved = await saveAsset(tx, storage, {
      tenant: t.tenant_id,
      project: t.project_id,
      user: t.created_by,
      kind: "deliverable",
      name: f.name,
      mime: f.mime,
      bytes: f.bytes,
      metadata: {
        task_id: t.id,
        media_effect_schema: body.schema,
        effect_id: input.effect_id,
        effect_version: input.version,
        effect_request_sha256: digest,
        provider_calls: 0,
        renderer: result.profile.renderer,
      },
    });
    files.push({
      asset_id: saved.id,
      asset_version_id: saved.version.id,
      filename: f.name,
      mime_type: f.mime,
      bytes: f.bytes.length,
      sha256: hash(f.bytes),
    });
  }
  return {
    schema: body.schema,
    effect_id: input.effect_id,
    request_sha256: digest,
    catalog_sha256: result.catalog_sha256,
    probe: result.probe,
    renderer_profile: result.profile,
    provider_calls: 0,
    ai_generation: false,
    files,
  };
}
