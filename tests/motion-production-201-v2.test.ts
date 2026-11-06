import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { createCanvas } from "@napi-rs/canvas";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import {
  historyLogin,
  historyOk,
  type HistoryClient,
} from "./admin-history-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { hash, canonical } from "../src/lib.js";
import { videoTemplates, videoTemplateIds } from "../src/video-templates.js";
import { videoDefinition } from "../src/video-project-model.js";
import {
  previewVideoFrame,
  renderVideoProject,
  videoRendererProfile,
} from "../src/video-render.js";
import { advanceVideoProjects } from "../src/video-projects.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});
async function call(
  c: HistoryClient,
  method: string,
  url: string,
  body?: unknown,
  key = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      cookie: c.cookie,
      "x-csrf-token": c.csrf,
      "x-tenant-id": c.tenant!,
      "idempotency-key": key,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
  return {
    status: raw.statusCode,
    raw,
    data: raw.headers["content-type"]?.includes("json") ? raw.json() : null,
  };
}
function ok(r: Awaited<ReturnType<typeof call>>) {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function fixture() {
  const user = await historyLogin(s),
    w = await historyOk(s, user, "POST", "/v1/tenants", {
      name: "Motion production review",
      project_name: "Controlled motion fixture",
    });
  user.tenant = w.tenant.id;
  const base = `/v1/tenants/${user.tenant}/projects/${w.project.id}`;
  const asset = (
    name: string,
    bytes: Buffer,
    mime = "image/png",
    privateOwner?: string,
  ) =>
    s.db.tx(
      (tx) =>
        saveAsset(tx, s.storage, {
          tenant: user.tenant!,
          project: w.project.id,
          user: user.id,
          name,
          bytes,
          mime,
          ...(privateOwner ? { privateOwner } : {}),
        }),
      user.tenant!,
      false,
      user.id,
    );
  return {
    user,
    base,
    root: base + "/video-projects",
    project: w.project.id,
    asset,
  };
}
const definition = () => videoTemplates("en", "square")[0].definition;
function png() {
  const c = createCanvas(320, 200),
    g = c.getContext("2d");
  g.fillStyle = "#2458df";
  g.fillRect(0, 0, 320, 200);
  return c.toBuffer("image/png");
}
const counts = async (t: string) =>
  (
    await s.db.control.query(
      `SELECT (SELECT count(*)::int FROM creative_projects WHERE tenant_id=$1) projects,(SELECT count(*)::int FROM assets WHERE tenant_id=$1) assets,(SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) calls,(SELECT count(*)::int FROM ledger WHERE tenant_id=$1) ledger`,
      [t],
    )
  ).rows[0];

test("all six bilingual layouts in three formats are valid actual editable content; old definitions remain unchanged", async () => {
  for (const locale of ["zh-HK", "en"] as const)
    for (const format of ["portrait", "square", "landscape"] as const) {
      const items = videoTemplates(locale, format);
      assert.deepEqual(
        items.map((x) => x.id),
        [...videoTemplateIds],
      );
      assert.equal(items.length, 6);
      for (const item of items) {
        assert.ok(videoDefinition.safeParse(item.definition).success);
        assert.equal(item.definition.locale, locale);
        assert.equal(item.definition.audio, null);
        assert.equal(item.definition.storyboard[0].transition, undefined);
        assert.equal(item.definition.duration_frames, 450);
      }
    }
  const d = definition();
  d.storyboard.forEach((x) => delete x.transition);
  const text = canonical(d);
  assert.equal(canonical(videoDefinition.parse(d)), text);
  assert.equal(
    (await videoRendererProfile(undefined, d)).renderer,
    "copypaste-campaign-cuts-2",
  );
  assert.equal(
    (await videoRendererProfile(undefined, definition())).renderer,
    "copypaste-campaign-cuts-3",
  );
  for (const frames of [0, 46, 1.5, 151]) {
    const x = definition();
    x.storyboard[1].transition!.frames = frames;
    assert.equal(videoDefinition.safeParse(x).success, false);
  }
  const first = definition();
  first.storyboard[0].transition = { kind: "crossfade", frames: 1 };
  assert.equal(videoDefinition.safeParse(first).success, false);
  const f = await fixture();
  assert.equal(
    ok(
      await call(
        f.user,
        "GET",
        f.root + "/templates?locale=en&format=landscape",
      ),
    ).items.length,
    6,
  );
  const outsider = await historyLogin(s);
  outsider.tenant = f.user.tenant;
  assert.ok(
    [403, 404].includes(
      (await call(outsider, "GET", f.root + "/templates")).status,
    ),
  );
});
test("crossfade and slide produce real distinct pixels with fixed captions and actual encoded full-frame output", async () => {
  const d = definition();
  d.width = 720;
  d.height = 720;
  d.duration_frames = 90;
  d.storyboard.forEach((scene, i) => {
    scene.start_frame = i * 30;
    scene.end_frame = (i + 1) * 30;
    if (scene.transition) scene.transition.frames = 10;
  });
  d.subtitles = [
    { key: "caption", start_frame: 0, end_frame: 90, text: "A fixed caption" },
  ];
  const frames = await Promise.all(
    [30, 35, 40, 60, 65, 70].map((f) => previewVideoFrame(d, f, [])),
  );
  assert.equal(new Set(frames.slice(0, 3).map((x) => x.sha256)).size, 3);
  assert.equal(new Set(frames.slice(3).map((x) => x.sha256)).size, 3);
  for (const f of frames) {
    assert.equal(hash(Buffer.from(f.base64, "base64")), f.sha256);
    assert.equal(f.definition_sha256, hash(canonical(d)));
    assert.equal(f.scope, "visual_frame_only");
    assert.equal(f.saved, false);
  }
  const crop = (v: (typeof frames)[number]) => {
    const p = PNG.sync.read(Buffer.from(v.base64, "base64"));
    return Buffer.concat(
      Array.from({ length: 70 }, (_, i) =>
        p.data.subarray(
          ((590 + i) * p.width + 60) * 4,
          ((590 + i) * p.width + 660) * 4,
        ),
      ),
    );
  };
  assert.deepEqual(crop(frames[0]), crop(frames[1]));
  assert.deepEqual(crop(frames[3]), crop(frames[4]));
  const rendered = await renderVideoProject(d, [], {
    dataDir: isolated.env.DATA_DIR!,
  });
  assert.equal(rendered.probe.duration_frames, 90);
  assert.equal(rendered.probe.fully_decoded, true);
  assert.equal(
    rendered.probe.renderer_profile.renderer,
    "copypaste-campaign-cuts-3",
  );
  assert.deepEqual(rendered.manifest.definition, d);
  assert.ok(rendered.bytes.length > 1000);
  await assert.rejects(previewVideoFrame(d, 90, []), {
    code: "VIDEO_FRAME_INVALID",
  });
});
test("preview has no writes or model charges, binds existing version and rechecks private, project, quarantine and digest authority", async () => {
  const f = await fixture(),
    a = await f.asset("Actual selected image.png", png()),
    privateImage = await f.asset(
      "Private image.png",
      png(),
      "image/png",
      f.user.id,
    ),
    d = definition();
  d.storyboard[1].image = { asset_id: a.id, version: 1 };
  const before = await counts(f.user.tenant!),
    r = await call(f.user, "POST", f.root + "/draft-preview", {
      definition: d,
      frame: 153,
    }),
    preview = ok(r);
  assert.equal(r.raw.headers["cache-control"], "no-store");
  assert.equal(hash(Buffer.from(preview.base64, "base64")), preview.sha256);
  assert.deepEqual(await counts(f.user.tenant!), before);
  const body = { name: "Immutable motion", definition: d },
    key = randomUUID(),
    created = ok(await call(f.user, "POST", f.root, body, key));
  assert.deepEqual(ok(await call(f.user, "POST", f.root, body, key)), created);
  assert.equal(
    (
      await call(f.user, "POST", f.root + "/draft-preview", {
        definition: d,
        frame: 153,
        video_id: created.id,
        expected_version: 2,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(f.user, "POST", f.root + "/draft-preview", {
        definition: d,
        frame: 153,
        video_id: created.id,
      })
    ).status,
    400,
  );
  const other = await historyOk(
    s,
    f.user,
    "POST",
    `/v1/tenants/${f.user.tenant}/projects`,
    { name: "Another project" },
  );
  assert.ok(
    [403, 404, 422].includes(
      (
        await call(
          f.user,
          "POST",
          f.root.replace(f.project, other.id) + "/draft-preview",
          { definition: d, frame: 153 },
        )
      ).status,
    ),
  );
  const forbidden = structuredClone(d);
  forbidden.storyboard[1].image = { asset_id: privateImage.id, version: 1 };
  assert.equal(
    (
      await call(f.user, "POST", f.root + "/draft-preview", {
        definition: forbidden,
        frame: 153,
      })
    ).status,
    422,
  );
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [a.id],
  );
  assert.equal(
    (
      await call(f.user, "POST", f.root + "/draft-preview", {
        definition: d,
        frame: 153,
      })
    ).status,
    422,
  );
  await s.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [
    a.id,
  ]);
  // Keep immutable database permissions. Inject corrupted storage bytes at
  // the existing adapter boundary without changing the authorization path.
  const originalGet=s.storage.get.bind(s.storage);
  s.storage.get=async()=>Buffer.from('Corrupted stored PNG bytes');
  try {
    const invalid=await call(f.user,'POST',f.root+'/draft-preview',{definition:d,frame:153});
    assert.equal(invalid.status,422);assert.equal(invalid.data.error.code,'VIDEO_SOURCE_INTEGRITY');
  } finally {s.storage.get=originalGet;}
  const after = await counts(f.user.tenant!);
  assert.equal(after.calls, before.calls);
  assert.equal(after.ledger, before.ledger);
  assert.equal(after.projects, before.projects + 1);
});
test("fixed resource search pages without private disclosure and treats wildcard characters literally", async () => {
  const f = await fixture();
  for (let i = 0; i < 22; i++)
    await f.asset("Shared motion " + i + ".png", png());
  await f.asset("Private motion.png", png(), "image/png", f.user.id);
  const literal = await f.asset("100%_actual.png", png());
  const first = ok(
    await call(f.user, "GET", f.root + "/resources?kind=image&q=Shared"),
  );
  assert.equal(first.items.length, 20);
  assert.ok(first.next_cursor);
  const second = ok(
    await call(
      f.user,
      "GET",
      f.root + "/resources?kind=image&q=Shared&cursor=" + first.next_cursor,
    ),
  );
  assert.equal(second.items.length, 2);
  assert.equal(second.next_cursor, null);
  assert.equal(
    new Set(
      [...first.items, ...second.items].map((x: any) => x.source_version_id),
    ).size,
    22,
  );
  const matched = ok(
    await call(
      f.user,
      "GET",
      f.root + "/resources?kind=image&q=" + encodeURIComponent("%_"),
    ),
  );
  assert.equal(matched.items.length, 1);
  assert.equal(matched.items[0].source_version_id, literal.version.id);
  assert.equal(
    ok(await call(f.user, "GET", f.root + "/resources?kind=image&q=Private"))
      .items.length,
    0,
  );
  assert.equal(
    ok(await call(f.user, "GET", f.root + "/resources?kind=audio")).items
      .length,
    0,
  );
});
test("actual transition project package restores its definition/profile and renders after an immutable edit", async () => {
  const f = await fixture(),
    d = definition();
  d.duration_frames = 90;
  d.storyboard.forEach((x, i) => {
    x.start_frame = i * 30;
    x.end_frame = (i + 1) * 30;
    if (x.transition) x.transition.frames = 10;
  });
  const original = ok(
    await call(f.user, "POST", f.root, {
      name: "Portable motion",
      definition: d,
    }),
  );
  const archive = await call(
    f.user,
    "GET",
    f.base +
      "/creative-project-packages/" +
      original.id +
      "?expected_version=1",
  );
  assert.equal(archive.status, 200);
  const bytes = archive.raw.rawPayload,
    digest = hash(bytes);
  assert.equal(archive.raw.headers["x-content-sha256"], digest);
  const a = await f.asset("Restorable motion.zip", bytes, "application/zip"),
    selection = { asset_id: a.id, version: 1, sha256: a.version.sha256 },
    preview = ok(
      await call(
        f.user,
        "POST",
        f.base + "/creative-project-packages/preview",
        selection,
      ),
    );
  const restored = ok(
      await call(
        f.user,
        "POST",
        f.base + "/creative-project-packages/restore",
        {
          ...selection,
          name: "Restored actual motion",
          preview_hash: preview.preview_hash,
          confirm_project_sharing: true,
          confirm_media_rights: true,
        },
      ),
    ),
    detail = ok(await call(f.user, "GET", f.root + "/" + restored.id));
  assert.deepEqual(detail.definition, d);
  detail.definition.script.title = "Edited restored motion";
  ok(
    await call(f.user, "POST", f.root + "/" + restored.id + "/edit", {
      name: "Edited motion",
      expected_version: 1,
      definition: detail.definition,
    }),
  );
  const queued = ok(
    await call(f.user, "POST", f.root + "/" + restored.id + "/renders", {
      expected_version: 2,
    }),
  );
  await advanceVideoProjects(s.db, s.storage);
  const finished = ok(
    await call(f.user, "GET", f.root + "/" + restored.id),
  ).renders.find((r: any) => r.id === queued.id);
  assert.equal(finished.state, "succeeded", JSON.stringify(finished));
  assert.equal(
    finished.probe.renderer_profile.renderer,
    "copypaste-campaign-cuts-3",
  );
  assert.equal(finished.probe.duration_frames, 90);
  assert.equal(finished.output_available, true);
  assert.equal((await counts(f.user.tenant!)).calls, 0);
});
