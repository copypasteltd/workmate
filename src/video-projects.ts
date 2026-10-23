import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { requireUser, audit, type Principal } from "./auth.js";
import { projectAccess, replay, key } from "./access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { Storage, saveAsset } from "./storage.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { assertDesktopVideoOrigin } from "./desktop-video-origin.js";
import {
  videoDefinition,
  videoCreate,
  videoEdit,
  videoRenderRequest,
  videoCancelRequest,
  videoStatus,
  videoReferences,
  type VideoDefinition,
  type VideoAssetRef,
} from "./video-project-model.js";
import {
  renderVideoProject,
  videoRendererProfile,
  type VideoSource,
} from "./video-render.js";

const scope = z.object({ tenant: uuid, project: uuid });
const projectParams = scope.extend({ video: uuid });
const renderParams = projectParams.extend({ render: uuid });
const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const renderColumns =
  "id,video_id,version,revision,state,error_code,mp4_asset_id,project_asset_id,script_asset_id,storyboard_asset_id,subtitles_asset_id,probe_asset_id,probe,ai_cost_micros::text,cost_source,elapsed_ms,output_bytes::text,created_at,started_at,finished_at";
export const videoOutputColumns =
  "mp4_asset_id,project_asset_id,script_asset_id,storyboard_asset_id,subtitles_asset_id,probe_asset_id";
async function parent(
  tx: Tx,
  tenant: string,
  project: string,
  id: string,
  db: Database,
  lock = false,
) {
  const p = (
    await tx.query(
      `SELECT * FROM creative_projects WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND kind='video' AND content_state='active' AND retention_expires_at>clock_timestamp() AND body->>'data_mode'=$4 ${lock ? "FOR UPDATE" : ""}`,
      [id, tenant, project, mode(db)],
    )
  ).rows[0];
  if (!p) throw new Problem(404, "NOT_FOUND", "Video project not found");
  return p;
}
async function source(
  tx: Tx,
  project: string,
  ref: VideoAssetRef,
  lock = false,
  privateOwner: string | null = null,
) {
  const v = (
    await tx.query(
      `SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$2 WHERE a.id=$1 AND a.project_id=$3 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND (a.private_owner IS NULL OR a.private_owner=$4) AND v.erased_at IS NULL AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id) ${lock ? "FOR SHARE OF a" : ""}`,
      [ref.asset_id, ref.version, project, privateOwner],
    )
  ).rows[0];
  if (
    !v ||
    !["image/png", "audio/wav", "audio/mpeg"].includes(v.mime_type) ||
    Number(v.bytes) > (v.mime_type === "image/png" ? 8_000_000 : 30_000_000)
  )
    throw new Problem(
      422,
      "VIDEO_SOURCE_UNAVAILABLE",
      "Choose an available shared project PNG, WAV or MP3 version",
    );
  return v;
}
async function fixedSources(
  tx: Tx,
  project: string,
  definition: VideoDefinition,
  privateOwner: string | null,
) {
  const result = [];
  for (const ref of videoReferences(definition)) {
    const v = await source(tx, project, ref, true, privateOwner);
    const isAudio =
      definition.audio &&
      definition.audio.source.asset_id === ref.asset_id &&
      definition.audio.source.version === ref.version;
    if (
      (isAudio && !["audio/wav", "audio/mpeg"].includes(v.mime_type)) ||
      (!isAudio && v.mime_type !== "image/png")
    )
      throw new Problem(
        422,
        "VIDEO_SOURCE_TYPE",
        "Choose image and audio versions for their matching tracks",
      );
    result.push({
      ...ref,
      sha256: v.sha256,
      mime_type: v.mime_type,
      bytes: Number(v.bytes),
    });
  }
  return result;
}
async function assertSources(tx: Tx, row: any) {
  const expected = (
    await tx.query(
      "SELECT asset_id,asset_version AS version,sha256,mime_type,bytes::text FROM video_project_sources WHERE video_id=$1 AND version=$2 ORDER BY asset_id,asset_version",
      [row.video_id, row.version],
    )
  ).rows;
  const refs = videoReferences(videoDefinition.parse(row.definition));
  if (refs.length !== expected.length)
    throw new Problem(
      409,
      "VIDEO_INPUT_INTEGRITY",
      "The saved source list changed",
    );
  for (const ref of refs) {
    const frozen = expected.find(
        (s) => s.asset_id === ref.asset_id && s.version === ref.version,
      ),
      current = await source(tx, row.project_id, ref, true, row.private_owner);
    if (
      !frozen ||
      frozen.sha256 !== current.sha256 ||
      frozen.mime_type !== current.mime_type ||
      frozen.bytes !== String(current.bytes)
    )
      throw new Problem(
        422,
        "VIDEO_SOURCE_INTEGRITY",
        "A fixed source version changed",
      );
  }
  return expected;
}
async function currentActor(tx: Tx, row: any): Promise<Principal> {
  await lockUserAuthorities(tx, [row.actor_id]);
  await assertDesktopVideoOrigin(tx, row);
  const u = (
    await tx.query(
      "SELECT id,name,email,auth_version,status FROM users WHERE id=$1",
      [row.actor_id],
    )
  ).rows[0];
  if (!u || u.status !== "active" || u.auth_version !== row.actor_auth_version)
    throw new Problem(
      403,
      "AUTHORIZATION_CHANGED",
      "The render owner's authorization changed",
    );
  const p: Principal = {
    id: u.id,
    name: u.name,
    email: u.email,
    authVersion: u.auth_version,
    audience: "user",
    sessionId: "",
    sessionHash: "",
  };
  await projectAccess(tx, p, row.tenant_id, row.project_id, "write");
  return p;
}
async function insertVersion(
  tx: Tx,
  p: any,
  definition: VideoDefinition,
  profile: unknown,
  actor: string,
) {
  const sources = await fixedSources(tx, p.project_id, definition, p.private_owner ?? null),
    inputHash = hash(
      canonical({
        definition,
        sources: [...sources].sort((a, b) =>
          (a.asset_id + ":" + a.version).localeCompare(
            b.asset_id + ":" + b.version,
          ),
        ),
        renderer_profile: profile,
      }),
    );
  await tx.query(
    "INSERT INTO video_project_versions(video_id,tenant_id,project_id,version,definition,input_hash,renderer_profile,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      p.id,
      p.tenant_id,
      p.project_id,
      p.version,
      definition,
      inputHash,
      profile,
      actor,
    ],
  );
  for (const s of sources)
    await tx.query(
      "INSERT INTO video_project_sources(video_id,version,tenant_id,project_id,asset_id,asset_version,sha256,mime_type,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        p.id,
        p.version,
        p.tenant_id,
        p.project_id,
        s.asset_id,
        s.version,
        s.sha256,
        s.mime_type,
        s.bytes,
      ],
    );
  return inputHash;
}
async function inputRow(tx: Tx, video: string, version: number) {
  const r = (
    await tx.query(
      "SELECT v.*,p.private_owner FROM video_project_versions v JOIN creative_projects p ON p.id=v.video_id WHERE video_id=$1 AND v.version=$2",
      [video, version],
    )
  ).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Video revision not found");
  return r;
}
async function detail(tx: Tx, p: any) {
  const versions = (
    await tx.query(
      "SELECT version,input_hash,renderer_profile,actor_id,created_at FROM video_project_versions WHERE video_id=$1 ORDER BY version DESC",
      [p.id],
    )
  ).rows;
  const renders = (
    await tx.query(
      `SELECT ${renderColumns},(state='succeeded' AND (SELECT count(*) FROM assets WHERE state='active' AND id=ANY(ARRAY[mp4_asset_id,project_asset_id,script_asset_id,storyboard_asset_id,subtitles_asset_id,probe_asset_id]))=6) AS output_available FROM video_renders WHERE video_id=$1 ORDER BY created_at DESC,id DESC`,
      [p.id],
    )
  ).rows;
  const current = await inputRow(tx, p.id, p.version);
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    data_mode: p.body.data_mode,
    definition: current.definition,
    renderer_profile: current.renderer_profile,
    input_hash: current.input_hash,
    versions,
    renders,
    cost: {
      ai_cost_micros: "0",
      source: "local_composition_no_ai",
      currency: "HKD",
    },
  };
}
export async function createVideoProject(
  tx: Tx,
  db: Database,
  principal: Principal,
  tenant: string,
  project: string,
  request: z.infer<typeof videoCreate>,
  profile: unknown,
  originTaskId?: string,
) {
  await projectAccess(tx, principal, tenant, project, "write");
  const p = (
    await tx.query(
      "INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by,private_owner,origin_task_id) VALUES($1,$2,$3,'video',$4,$5,$6,$7) RETURNING *",
      [
        tenant,
        project,
        request.name,
        { schema_version: "copypaste-video-1", data_mode: mode(db) },
        principal.id,
        originTaskId ? principal.id : null,
        originTaskId ?? null,
      ],
    )
  ).rows[0];
  await insertVersion(tx, p, request.definition, profile, principal.id);
  await audit(
    tx,
    principal,
    "video.project.create",
    p.id,
    "succeeded",
    { version: 1, ai_cost_micros: "0" },
    tenant,
  );
  return { id: p.id, version: 1 };
}
export async function enqueueVideoRender(
  tx: Tx,
  db: Database,
  principal: Principal,
  tenant: string,
  project: string,
  video: string,
  version: number,
  originTaskId?: string,
) {
  await projectAccess(tx, principal, tenant, project, "write");
  const p = await parent(tx, tenant, project, video, db, true);
  if (originTaskId && p.private_owner !== principal.id)
    throw new Problem(409, "DESKTOP_PRIVATE_VIDEO_REQUIRED", "Create a private video project from this desktop specialist");
  if (p.version !== version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "The video project changed; reload it",
    );
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "video-admission:" + project,
  ]);
  if (
    (
      await tx.query(
        "SELECT 1 FROM video_renders WHERE video_id=$1 AND state IN('queued','rendering')",
        [video],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "VIDEO_ALREADY_RENDERING",
      "This video already has an active render",
    );
  const counts = (
    await tx.query(
      "SELECT count(*) FILTER(WHERE video_id=$1) AS total,count(*) FILTER(WHERE project_id=$2 AND state IN('queued','rendering')) AS pending FROM video_renders",
      [video, project],
    )
  ).rows[0];
  if (Number(counts.total) >= 100)
    throw new Problem(
      409,
      "VIDEO_RENDER_LIMIT",
      "This project reached 100 render records; create a new video project",
    );
  if (Number(counts.pending) >= 20)
    throw new Problem(
      429,
      "VIDEO_QUEUE_FULL",
      "Wait for existing video renders before adding more",
    );
  const input = await inputRow(tx, video, version);
  await assertSources(tx, input);
  const render = (
    await tx.query(
      "INSERT INTO video_renders(video_id,version,tenant_id,project_id,actor_id,actor_auth_version,input_hash,origin_task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,revision,state",
      [
        video,
        version,
        tenant,
        project,
        principal.id,
        principal.authVersion,
        input.input_hash,
        originTaskId ?? null,
      ],
    )
  ).rows[0];
  await audit(
    tx,
    principal,
    "video.render.queue",
    video,
    "succeeded",
    { render_id: render.id, version },
    tenant,
  );
  return { video_id: video, ...render };
}

/** Shared with the native specialist; a revision and its immutable inputs are
 * committed atomically with any render the caller chooses to enqueue. */
export async function editVideoProject(
  tx: Tx, db: Database, principal: Principal, tenant: string, project: string,
  video: string, request: z.infer<typeof videoEdit>, profile: unknown,
  privateOnly = false,
) {
  await projectAccess(tx, principal, tenant, project, "write");
  const p = await parent(tx, tenant, project, video, db, true);
  if (privateOnly && p.private_owner !== principal.id)
    throw new Problem(409, "DESKTOP_PRIVATE_VIDEO_REQUIRED", "Copy the timeline into a new private desktop video project before editing");
  if (p.version !== request.expected_version)
    throw new Problem(409, "VERSION_CONFLICT", "The video project changed; reload it");
  if (p.version >= 50)
    throw new Problem(409, "VIDEO_VERSION_LIMIT", "This video reached 50 versions; create a new project");
  await tx.query("UPDATE creative_projects SET name=$2,version=version+1,body=jsonb_set(body,'{last_edited_at}',to_jsonb(clock_timestamp())) WHERE id=$1", [video, request.name]);
  await insertVersion(tx, { ...p, version: p.version + 1 }, request.definition, profile, principal.id);
  await audit(tx, principal, "video.project.edit", video, "succeeded", { version: p.version + 1 }, tenant);
  return { id: video, version: p.version + 1 };
}

export async function cancelVideoRender(
  tx: Tx, db: Database, principal: Principal, tenant: string, project: string,
  video: string, render: string, expectedRevision: number,
) {
  await projectAccess(tx, principal, tenant, project, "write");
  await parent(tx, tenant, project, video, db, true);
  const r = (await tx.query("SELECT * FROM video_renders WHERE id=$1 AND video_id=$2 FOR UPDATE", [render, video])).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Video render not found");
  if (r.revision !== expectedRevision) throw new Problem(409, "VERSION_CONFLICT", "The render state changed; reload it");
  if (!["queued", "rendering"].includes(r.state)) throw new Problem(409, "VIDEO_RENDER_FINISHED", "This render already finished");
  await tx.query("UPDATE video_renders SET state='cancelled',revision=revision+1,error_code='VIDEO_CANCELLED',finished_at=clock_timestamp() WHERE id=$1", [render]);
  await audit(tx, principal, "video.render.cancel", video, "succeeded", { render_id: render }, tenant);
  return { id: render, revision: r.revision + 1, state: "cancelled" as const };
}

/** Bounded native tool result: no storage paths, arbitrary URLs or binary data.
 * Every output must remain available before any of the six is disclosed. */
export async function videoRenderToolStatus(
  tx: Tx, db: Database, principal: Principal, tenant: string, project: string,
  video: string, render: string,
) {
  await projectAccess(tx, principal, tenant, project);
  const p = await parent(tx, tenant, project, video, db);
  const r = (await tx.query(`SELECT ${renderColumns} FROM video_renders WHERE id=$1 AND video_id=$2`, [render, video])).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Video render not found");
  let assets: { id: string; name: string; version: { id: string; version: number; mime_type: string; bytes: string; sha256: string } }[] = [];
  if (r.state === "succeeded") {
    const ids = [r.mp4_asset_id, r.project_asset_id, r.script_asset_id, r.storyboard_asset_id, r.subtitles_asset_id, r.probe_asset_id];
    const rows = (await tx.query(
      `SELECT a.id,a.name,v.id AS version_id,v.version,v.mime_type,v.bytes::text,v.sha256
       FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=1
       WHERE a.id=ANY($1::uuid[]) AND a.project_id=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp()
       AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`, [ids, project],
    )).rows;
    if (rows.length === 6) assets = ids.map(id => {
      const a = rows.find(a => a.id === id)!;
      return { id: a.id, name: a.name, version: { id: a.version_id, version: a.version, mime_type: a.mime_type, bytes: a.bytes, sha256: a.sha256 } };
    });
  }
  const pending = ["queued", "rendering"].includes(r.state);
  return videoStatus.parse({
    project: { id: p.id, name: p.name, version: p.version },
    render: { id: r.id, version: r.version, revision: r.revision, state: r.state, error_code: r.error_code, probe: r.probe },
    delivery_state: pending ? r.state : r.state === "succeeded" ? assets.length === 6 ? "available" : "unavailable" : r.state,
    requires_render_completion: pending, retry_after_ms: pending ? 1000 : 0,
    ai_cost_micros: "0", cost_source: "local_composition_no_ai", assets,
  });
}

export async function listVideoToolProjects(
  tx: Tx, db: Database, principal: Principal, tenant: string, project: string, beforeId?: string,
) {
  await projectAccess(tx, principal, tenant, project);
  const before = beforeId ? await parent(tx, tenant, project, beforeId, db) : null;
  const rows = (await tx.query(
    `SELECT id,name,version,created_at FROM creative_projects WHERE tenant_id=$1 AND project_id=$2 AND kind='video'
     AND content_state='active' AND retention_expires_at>clock_timestamp() AND body->>'data_mode'=$3
     AND ($4::timestamptz IS NULL OR (created_at,id)<($4,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 21`,
    [tenant, project, mode(db), before?.created_at ?? null, before?.id ?? null],
  )).rows;
  return { items: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].id : null };
}

export async function readVideoToolProject(
  tx: Tx, db: Database, principal: Principal, tenant: string, project: string, video: string,
) {
  await projectAccess(tx, principal, tenant, project);
  return detail(tx, await parent(tx, tenant, project, video, db));
}
export function registerVideoProjects(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const base = "/v1/tenants/:tenant/projects/:project/video-projects";
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = scope.parse(req.params),
      q = z.object({ before: uuid.optional() }).strict().parse(req.query);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const before = q.before
        ? await parent(tx, tenant, project, q.before, db)
        : null;
      const rows = (
        await tx.query(
          "SELECT id,name,version,created_at FROM creative_projects WHERE tenant_id=$1 AND project_id=$2 AND kind='video' AND content_state='active' AND retention_expires_at>clock_timestamp() AND body->>'data_mode'=$3 AND ($4::timestamptz IS NULL OR (created_at,id)<($4,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 21",
          [
            tenant,
            project,
            mode(db),
            before?.created_at ?? null,
            before?.id ?? null,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, 20),
        next_cursor: rows.length > 20 ? rows[19].id : null,
      };
    }, tenant);
  });
  app.post(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = scope.parse(req.params),
      b = videoCreate.parse(req.body),
      requestKey = key(req),
      profile = await videoRendererProfile();
    return db.tx(async (tx) => {
      await lockUserAuthorities(tx, [req.principal.id]);
      await projectAccess(tx, req.principal, tenant, project, "write");
      return replay(
        tx,
        req.principal.id,
        "video.project.create:" + project,
        requestKey,
        b,
        () =>
          createVideoProject(
            tx,
            db,
            req.principal,
            tenant,
            project,
            b,
            profile,
          ),
      );
    }, tenant);
  });
  app.get(base + "/:video", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, video } = projectParams.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return detail(tx, await parent(tx, tenant, project, video, db));
    }, tenant);
  });
  app.post(
    base + "/:video/edit",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, video } = projectParams.parse(req.params),
        b = videoEdit.parse(req.body),
        requestKey = key(req),
        profile = await videoRendererProfile();
      return db.tx(async (tx) => {
        await lockUserAuthorities(tx, [req.principal.id]);
        await projectAccess(tx, req.principal, tenant, project, "write");
        await parent(tx, tenant, project, video, db, true);
        return replay(
          tx,
          req.principal.id,
          "video.project.edit:" + video,
          requestKey,
          b,
          () => editVideoProject(tx, db, req.principal, tenant, project, video, b, profile),
        );
      }, tenant);
    },
  );
  app.post(
    base + "/:video/renders",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, video } = projectParams.parse(req.params),
        b = videoRenderRequest.parse(req.body),
        requestKey = key(req);
      return db.tx(async (tx) => {
        await lockUserAuthorities(tx, [req.principal.id]);
        await projectAccess(tx, req.principal, tenant, project, "write");
        await parent(tx, tenant, project, video, db, true);
        return replay(
          tx,
          req.principal.id,
          "video.render.queue:" + video,
          requestKey,
          b,
          () =>
            enqueueVideoRender(
              tx,
              db,
              req.principal,
              tenant,
              project,
              video,
              b.expected_version,
            ),
        );
      }, tenant);
    },
  );
  app.post(
    base + "/:video/renders/:render/cancel",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, video, render } = renderParams.parse(req.params),
        b = videoCancelRequest.parse(req.body),
        requestKey = key(req);
      return db.tx(async (tx) => {
        await lockUserAuthorities(tx, [req.principal.id]);
        await projectAccess(tx, req.principal, tenant, project, "write");
        await parent(tx, tenant, project, video, db, true);
        return replay(
          tx,
          req.principal.id,
          "video.render.cancel:" + render,
          requestKey,
          b,
          () => cancelVideoRender(tx, db, req.principal, tenant, project, video, render, b.expected_revision),
        );
      }, tenant);
    },
  );
  app.get(base + "/:video/renders/:render/status", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project, video, render } = renderParams.parse(req.params);
    reply.header("Cache-Control", "no-store");
    return db.tx(tx => videoRenderToolStatus(tx, db, req.principal, tenant, project, video, render), tenant);
  });
  app.get(
    base + "/:video/renders/:render/preview",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { tenant, project, video, render } = renderParams.parse(req.params);
      reply.header("Cache-Control", "no-store");
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        await parent(tx, tenant, project, video, db);
        const v = (
          await tx.query(
            "SELECT v.* FROM video_renders r JOIN assets a ON a.id=r.mp4_asset_id AND a.state='active' JOIN asset_versions v ON v.asset_id=a.id AND v.version=1 WHERE r.id=$1 AND r.video_id=$2 AND r.state='succeeded'",
            [render, video],
          )
        ).rows[0];
        if (!v)
          throw new Problem(404, "NOT_FOUND", "Video preview unavailable");
        if (Number(v.bytes) > 20_000_000)
          throw new Problem(
            413,
            "VIDEO_PREVIEW_LIMIT",
            "Download this video for playback; the inline preview limit is 20 MB",
          );
        const bytes = await storage.get(v.storage_key);
        // Recheck current policy after I/O, before releasing any protected bytes.
        await projectAccess(tx, req.principal, tenant, project);
        await parent(tx, tenant, project, video, db);
        if (
          !(
            await tx.query(
              "SELECT 1 FROM assets WHERE id=$1 AND state='active'",
              [v.asset_id],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Video preview unavailable");
        if (
          bytes.length !== Number(v.bytes) ||
          hash(bytes) !== v.sha256 ||
          v.mime_type !== "video/mp4"
        )
          throw new Problem(
            422,
            "VIDEO_OUTPUT_INTEGRITY",
            "The saved video failed its byte check",
          );
        return {
          content_type: "video/mp4",
          base64: bytes.toString("base64"),
          bytes: bytes.length,
          sha256: v.sha256,
        };
      }, tenant);
    },
  );
}
/** Independent Admin body permission must be checked by the caller. */
export async function videoContentBody(tx: Tx, p: any) {
  return {
    definition: p.body,
    versions: (
      await tx.query(
        "SELECT version,definition,input_hash,renderer_profile,actor_id,created_at FROM video_project_versions WHERE video_id=$1 ORDER BY version",
        [p.id],
      )
    ).rows,
    sources: (
      await tx.query(
        "SELECT version,asset_id,asset_version,sha256,mime_type,bytes::text FROM video_project_sources WHERE video_id=$1 ORDER BY version,asset_id",
        [p.id],
      )
    ).rows,
    renders: (
      await tx.query(
        `SELECT ${renderColumns} FROM video_renders WHERE video_id=$1 ORDER BY created_at,id`,
        [p.id],
      )
    ).rows,
  };
}
const errorCode = (e: unknown) =>
  e instanceof Problem && /^[A-Z_]{3,60}$/.test(e.code)
    ? e.code
    : "VIDEO_RENDER_FAILED";
async function verifyInput(tx: Tx, row: any) {
  const sources = await assertSources(tx, row);
  const normalized = sources
    .map((s) => ({
      asset_id: s.asset_id,
      version: s.version,
      sha256: s.sha256,
      mime_type: s.mime_type,
      bytes: Number(s.bytes),
    }))
    .sort((a, b) =>
      (a.asset_id + ":" + a.version).localeCompare(
        b.asset_id + ":" + b.version,
      ),
    );
  if (
    hash(
      canonical({
        definition: videoDefinition.parse(row.definition),
        sources: normalized,
        renderer_profile: row.renderer_profile,
      }),
    ) !== row.input_hash
  )
    throw new Problem(
      409,
      "VIDEO_INPUT_INTEGRITY",
      "The saved video input failed verification",
    );
  return sources;
}
/** Durable local composition: two global slots and one per tenant, without a long SQL transaction. */
export async function advanceVideoProjects(
  db: Database,
  storage: Storage,
  renderer = renderVideoProject,
  options: { leaseSeconds?: number; signal?: AbortSignal } = {},
) {
  const lease = z
    .number()
    .int()
    .min(1)
    .max(210)
    .parse(options.leaseSeconds ?? 210);
  const claim = await db.tx(
    async (tx) => {
      if (
        !(
          await tx.query(
            "SELECT pg_try_advisory_xact_lock(hashtextextended('video-render-claim',0)) AS locked",
          )
        ).rows[0].locked
      )
        return null;
      const expired = (
        await tx.query(
          "SELECT id,video_id FROM video_renders WHERE state='rendering' AND lease_until<clock_timestamp() ORDER BY lease_until LIMIT 10",
        )
      ).rows;
      for (const r of expired) {
        await tx.query(
          "SELECT id FROM creative_projects WHERE id=$1 FOR UPDATE",
          [r.video_id],
        );
        await tx.query(
          "UPDATE video_renders SET state='failed',revision=revision+1,error_code='VIDEO_RENDER_INTERRUPTED',finished_at=clock_timestamp() WHERE id=$1 AND state='rendering' AND lease_until<clock_timestamp()",
          [r.id],
        );
      }
      if (
        Number(
          (
            await tx.query(
              "SELECT count(*) FROM video_renders WHERE state='rendering'",
            )
          ).rows[0].count,
        ) >= 2
      )
        return null;
      const candidate = (
        await tx.query(
          "SELECT r.* FROM video_renders r JOIN creative_projects p ON p.id=r.video_id WHERE r.state='queued' AND p.content_state='active' AND p.body->>'data_mode'=$1 AND NOT EXISTS(SELECT 1 FROM video_renders busy WHERE busy.tenant_id=r.tenant_id AND busy.state='rendering') ORDER BY r.created_at,r.id LIMIT 1",
          [mode(db)],
        )
      ).rows[0];
      if (!candidate) return null;
      await lockUserAuthorities(tx, [candidate.actor_id]);
      // Native origin locks precede project/render locks, including at claim.
      // Record a denied origin inside the ordinary claim savepoint below so an
      // expired owner cannot leave a queued job starving the remaining queue.
      let originError: unknown;
      try { await assertDesktopVideoOrigin(tx, candidate); } catch (error) { originError = error; }
      // Lock in the same order as user actions, then record a validation failure
      // inside the savepoint if an active parent has expired since queueing.
      await tx.query(
        "SELECT id FROM creative_projects WHERE id=$1 FOR UPDATE",
        [candidate.video_id],
      );
      const r = (
        await tx.query(
          "SELECT * FROM video_renders WHERE id=$1 AND state='queued' FOR UPDATE",
          [candidate.id],
        )
      ).rows[0];
      if (!r) return null;
      const input = await inputRow(tx, r.video_id, r.version),
        row = {
          ...input,
          ...r,
          definition: input.definition,
          renderer_profile: input.renderer_profile,
        };
      await tx.query("SAVEPOINT video_claim_validation");
      try {
        if (originError) throw originError;
        await parent(tx, row.tenant_id, row.project_id, row.video_id, db);
        await currentActor(tx, row);
        await verifyInput(tx, row);
      } catch (e) {
        await tx.query("ROLLBACK TO SAVEPOINT video_claim_validation");
        await tx.query(
          "UPDATE video_renders SET state='failed',revision=revision+1,error_code=$2,finished_at=clock_timestamp() WHERE id=$1",
          [r.id, errorCode(e)],
        );
        await audit(
          tx,
          { id: r.actor_id, audience: "user" },
          "video.render.denied",
          r.video_id,
          "denied",
          { render_id: r.id, error_code: errorCode(e) },
          r.tenant_id,
        );
        return { denied: true, id: r.id };
      }
      await tx.query("RELEASE SAVEPOINT video_claim_validation");
      const active = (
        await tx.query(
          "UPDATE video_renders SET state='rendering',revision=revision+1,lease_token=$2,lease_until=clock_timestamp()+make_interval(secs=>$3),started_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [r.id, randomUUID(), lease],
        )
      ).rows[0];
      return { ...row, ...active, denied: false };
    },
    undefined,
    true,
  );
  if (!claim || claim.denied) return claim;
  const started = Date.now(),
    controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let watch: Promise<unknown> | null = null;
  let invalidated: unknown;
  const timer = setInterval(() => {
    if (watch || controller.signal.aborted) return;
    watch = db
      .tx(
        async (tx) => {
          await currentActor(tx, claim);
          await parent(
            tx,
            claim.tenant_id,
            claim.project_id,
            claim.video_id,
            db,
          );
          await verifyInput(tx, claim);
          if (
            !(
              await tx.query(
                "SELECT 1 FROM video_renders WHERE id=$1 AND state='rendering' AND lease_token=$2 AND lease_until>clock_timestamp()",
                [claim.id, claim.lease_token],
              )
            ).rowCount
          )
            controller.abort();
        },
        claim.tenant_id,
        true,
        claim.actor_id,
      )
      .catch((e) => {
        invalidated = e;
        controller.abort();
      })
      .finally(() => {
        watch = null;
      });
  }, 750);
  const deadline = setTimeout(() => controller.abort(), 180000);
  try {
    const sources = await db.tx(
      async (tx) => {
        await currentActor(tx, claim);
        await parent(tx, claim.tenant_id, claim.project_id, claim.video_id, db);
        const expected = await verifyInput(tx, claim),
          result: VideoSource[] = [];
        for (const ref of expected) {
          const current = await source(tx, claim.project_id, ref, true, claim.private_owner),
            bytes = await storage.get(current.storage_key);
          if (bytes.length !== Number(ref.bytes) || hash(bytes) !== ref.sha256)
            throw new Problem(
              422,
              "VIDEO_SOURCE_INTEGRITY",
              "A fixed source failed its byte check",
            );
          result.push({
            asset_id: ref.asset_id,
            version: ref.version,
            sha256: ref.sha256,
            mime_type: ref.mime_type,
            bytes,
          });
        }
        return result;
      },
      claim.tenant_id,
      true,
      claim.actor_id,
    );
    const result = await renderer(
      videoDefinition.parse(claim.definition),
      sources,
      {
        dataDir: db.config.DATA_DIR,
        expectedProfile: claim.renderer_profile,
        signal: controller.signal,
      },
    );
    return await db.tx(
      async (tx) => {
        const principal = await currentActor(tx, claim);
        await parent(
          tx,
          claim.tenant_id,
          claim.project_id,
          claim.video_id,
          db,
          true,
        );
        const r = (
          await tx.query(
            "SELECT * FROM video_renders WHERE id=$1 AND state='rendering' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE",
            [claim.id, claim.lease_token],
          )
        ).rows[0];
        if (!r) return { stale: true, id: claim.id };
        if (controller.signal.aborted)
          throw new Problem(
            409,
            "VIDEO_CANCELLED",
            "Video rendering was cancelled",
          );
        await verifyInput(tx, claim);
        const outputs: [string, string, Buffer][] = [
          ["mp4", "video/mp4", result.bytes],
          [
            "project.json",
            "application/json",
            Buffer.from(canonical(result.manifest)),
          ],
          ["script.md", "text/markdown", Buffer.from(result.script)],
          [
            "storyboard.json",
            "application/json",
            Buffer.from(canonical(result.storyboard)),
          ],
          ["subtitles.vtt", "text/vtt", Buffer.from(result.subtitles)],
          [
            "probe.json",
            "application/json",
            Buffer.from(canonical(result.probe)),
          ],
        ];
        const ids = [];
        for (const [extension, mime, bytes] of outputs) {
          const a = await saveAsset(tx, storage, {
            tenant: claim.tenant_id,
            project: claim.project_id,
            user: claim.actor_id,
            name: `video-${claim.video_id}-v${claim.version}-${claim.id}.${extension}`,
            kind: "video_project_output",
            mime,
            bytes,
            metadata: {
              video_project: claim.video_id,
              video_version: claim.version,
              render_id: claim.id,
              input_hash: claim.input_hash,
              ai_cost_micros: "0",
              cost_source: "local_composition_no_ai",
              ...(claim.origin_task_id ? { task_id: claim.origin_task_id } : {}),
            },
          });
          ids.push(a.id);
        }
        await tx.query(
          "UPDATE video_renders SET state='succeeded',revision=revision+1,mp4_asset_id=$2,project_asset_id=$3,script_asset_id=$4,storyboard_asset_id=$5,subtitles_asset_id=$6,probe_asset_id=$7,probe=$8,elapsed_ms=$9,output_bytes=$10,finished_at=clock_timestamp() WHERE id=$1",
          [
            r.id,
            ...ids,
            result.probe,
            Date.now() - started,
            outputs.reduce((sum, o) => sum + o[2].length, 0),
          ],
        );
        await audit(
          tx,
          principal,
          "video.render.succeeded",
          claim.video_id,
          "succeeded",
          {
            render_id: r.id,
            version: claim.version,
            asset_ids: ids,
            ai_cost_micros: "0",
          },
          claim.tenant_id,
        );
        return { id: r.id, state: "succeeded", asset_ids: ids };
      },
      claim.tenant_id,
      true,
      claim.actor_id,
    );
  } catch (e) {
    await watch;
    // Preserve the policy denial that aborted the encoder rather than reporting
    // an authorization change as if the user had requested cancellation.
    const failureCode = errorCode(invalidated ?? e);
    return db.tx(
      async (tx) => {
        await tx.query(
          "SELECT id FROM creative_projects WHERE id=$1 FOR UPDATE",
          [claim.video_id],
        );
        const failed = await tx.query(
          "UPDATE video_renders SET state='failed',revision=revision+1,error_code=$3,elapsed_ms=$4,finished_at=clock_timestamp() WHERE id=$1 AND state='rendering' AND lease_token=$2 RETURNING id",
          [claim.id, claim.lease_token, failureCode, Date.now() - started],
        );
        if (failed.rowCount)
          await audit(
            tx,
            { id: claim.actor_id, audience: "user" },
            "video.render.failed",
            claim.video_id,
            "failed",
            { render_id: claim.id, error_code: failureCode },
            claim.tenant_id,
          );
        return {
          id: claim.id,
          state: failed.rowCount ? "failed" : "stale",
          error_code: failureCode,
        };
      },
      undefined,
      true,
    );
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", abort);
    await watch;
  }
}
