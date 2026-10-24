import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { audioProviderFixture } from "./audio-production-fixture.js";
import { nativeVideoFixture, startNativeVideo } from "./desktop-video-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import { validateProductionAudio } from "../src/audio-production-media.js";
import { saveAsset } from "../src/storage.js";
import { canonical, hash } from "../src/lib.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { AudioProduction } from "../src/audio-production.js";

test("populated SQL101 audio upgrade cancels unsubmitted work, retains unknown spend and exact completed bytes without backfilling human confirmation", async () => {
  const isolated = await isolatedTestEnvironment({ throughVersion: 101 });
  let s: Awaited<ReturnType<typeof buildApp>> | undefined, provider: Awaited<ReturnType<typeof audioProviderFixture>> | undefined;
  const owner = new pg.Client({ connectionString: isolated.env.OWNER_DATABASE_URL });
  try {
    provider = await audioProviderFixture(isolated.directory);
    s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
      AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-upgrade-reasoning", AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
      AI_SPEECH_MODEL: "synthetic-upgrade-speech", AI_SPEECH_VERIFIED: "true", AI_SPEECH_VOICES: "alloy", AI_SPEECH_LOCALES: "en", AI_SPEECH_HKD_MICROS_PER_CHARACTER: "100",
    }), { worker: false });
    const system = s;
    const policy = (await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,tenant_slots,actor_slots,
      text_slots,image_slots,video_slots,audio_slots,verification_slots,global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,audio_rpm,verification_rpm,reason)
      VALUES('configured_services',(SELECT max(version)+1 FROM ai_gateway_policy_versions WHERE data_mode='configured_services'),
      100,100,100,100,100,100,100,100,1000,1000,1000,1000,1000,1000,1000,1000,'Explicit populated SQL101 upgrade fixture') RETURNING id`)).rows[0];
    await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [policy.id]);
    const f = await nativeVideoFixture(s), index = s.catalog.roles.findIndex(role => role.role_key === "video-motion");
    const current = s.catalog.roles[index], historical = s.catalog.historicalRoles.find(role => role.role_key === "video-motion" && role.version === "1.3.0");
    assert.ok(historical); let started: Awaited<ReturnType<typeof startNativeVideo>>;
    try { s.catalog.roles[index] = historical; started = await startNativeVideo(s, f); } finally { s.catalog.roles[index] = current; }
    const task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [started.task.task_id])).rows[0];
    const probe = await validateProductionAudio(s.db.config, provider.bytes, "audio/wav");
    const ids: string[] = [];
    for (const state of ["prepared", "dispatched", "completed"]) {
      const spec = { kind: "speech", text: "Published legacy " + state, locale: "en", voice: "alloy", speed: 1,
        rights: { authorized: true, reference: "Historical model parameter, not human confirmation", purpose: "Explicit synthetic upgrade fixture" } };
      ids.push(await s.db.tx(async tx => {
        await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
        const cap = (await taskCapabilities(tx, system.db.config, system.catalog, task)).speech!;
        const id = (await tx.query("SELECT prepare_ai_audio_job($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,NULL,$7) AS id",
          [task.id, task.fencing_token, "legacy_" + randomUUID(), spec, hash(canonical(spec)), cap.id, [...spec.text].length])).rows[0].id;
        if (state !== "prepared") {
          await tx.query("UPDATE ai_audio_jobs SET state='dispatched',request_hash=$2,dispatched_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [id, hash("legacy-original-request-" + id)]);
          await tx.query("INSERT INTO ai_audio_job_events(job_id,kind) VALUES($1,'dispatched')", [id]);
        }
        if (state === "completed") {
          await tx.query(`UPDATE ai_audio_jobs SET state='completed',usage_known=true,billable_units=quoted_units,response_sha256=$2,
            response_bytes=$3,duration_ms=$4,decoded_media=$5,delivery_state='available',finished_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,
          [id, hash(provider!.bytes), provider!.bytes.length, probe.duration_ms, probe]);
          await tx.query("INSERT INTO ai_audio_job_events(job_id,kind) VALUES($1,'completed')", [id]);
        }
        return id;
      }, f.tenant, true, f.c.id));
    }
    const completed = (await s.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=$1", [ids[2]])).rows[0];
    const asset = await s.db.tx(async tx => {
      await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
      const value = await saveAsset(tx, system.storage, { tenant: f.tenant, project: f.project, user: f.c.id, privateOwner: f.c.id,
        name: "explicit-legacy-decoded-tone.wav", mime: "audio/wav", kind: "audio_production", bytes: provider!.bytes,
        metadata: { task_id: task.id, audio_job_id: ids[2], artifact_kind: "audio", subtitle_revision: 0 } });
      await tx.query("INSERT INTO ai_audio_job_artifacts(job_id,revision,kind,asset_id,asset_version,created_by,reason) VALUES($1,0,'audio',$2,1,$3,'Original published decoded fixture')", [ids[2], value.id, f.c.id]);
      return value;
    }, f.tenant, true, f.c.id);
    await owner.connect(); await runMigrations(owner, "populated SQL101 audio consent upgrade");
    assert.equal((await owner.query("SELECT max(version) AS v FROM schema_migrations")).rows[0].v, 102);
    const rows = (await s.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=ANY($1)", [ids])).rows;
    const prepared = rows.find(row => row.id === ids[0]), unknown = rows.find(row => row.id === ids[1]), retained = rows.find(row => row.id === ids[2]);
    assert.equal(prepared.state, "cancelled"); assert.equal(prepared.actual_micros, "0");
    assert.equal(unknown.state, "unknown"); assert.equal(unknown.usage_known, false); assert.equal(unknown.actual_micros, null);
    assert.deepEqual(retained, { ...completed, authorization_id: null });
    assert.ok(rows.every(row => row.authorization_id === null));
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audio_authorizations")).rows[0].n, 0);
    const u = (await s.db.control.query("SELECT * FROM users WHERE id=$1", [f.c.id])).rows[0];
    const actor = { id: u.id, name: u.name, email: u.email, authVersion: u.auth_version, audience: "user" as const, sessionId: "", sessionHash: "" };
    const audio = new AudioProduction(s.db, s.catalog, s.storage), view = await audio.read(actor, f.tenant, f.project, retained.id);
    assert.equal(view.authorization_basis, "legacy_model_declaration"); assert.equal(view.assets[0].sha256, hash(provider.bytes));
    assert.equal((await audio.preview(actor, f.tenant, f.project, retained.id, "audio")).sha256, hash(provider.bytes));
    const originalObject = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [asset.version.id])).rows[0];
    assert.deepEqual(await s.storage.get(originalObject.storage_key), provider.bytes);
    await runMigrations(owner, "unchanged SQL102 audio consent replay");
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audio_authorizations")).rows[0].n, 0);
    assert.equal(provider.calls.length, 0);
  } finally {
    await owner.end().catch(() => {});
    try { await s?.app.close(); } finally { try { await provider?.close(); } finally { await isolated.cleanup(); } }
  }
});
