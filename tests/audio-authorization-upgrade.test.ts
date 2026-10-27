import { test } from "node:test";
import { readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { audioProviderFixture } from "./audio-production-fixture.js";
import { nativeVideoFixture, videoOK } from "./desktop-video-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { freezeTaskCapabilities, taskCapabilities } from "../src/capability-bindings.js";
import { freezeTaskSkills } from "../src/skill-lifecycle.js";
import { authorizeTaskPlan } from "../src/plans.js";
import { reserve } from "../src/billing.js";
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
    assert.ok(historical);
    let task: any;
    try {
      s.catalog.roles[index] = historical;
      // Seed an already-existing SQL101 task, rather than invoking current
      // admission against a schema that intentionally predates SQL103.
      const legacy = await s.db.tx(async tx => {
        const user = (await tx.query("SELECT auth_version FROM users WHERE id=$1", [f.c.id])).rows[0];
        const family = (await tx.query("SELECT family_id FROM refresh_tokens WHERE user_id=$1 AND client_id='desktop' AND revoked_at IS NULL", [f.c.id])).rows[0];
        assert.ok(family);
        const plan = await authorizeTaskPlan(tx, f.tenant, f.c.id, historical, 1000000);
        const value = (await tx.query(`INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,
          budget_micros,idempotency_key,actor_auth_version,mode,private_owner,input_context,plan_snapshot,execution_location)
          VALUES($1,$2,$3,'Published SQL101 local audio task','Retain existing synthetic audio evidence',
          'video-motion',$4,1000000,$5,$6,'execute',$3,'{}'::jsonb,$7,'desktop') RETURNING *`,
        [f.tenant, f.project, f.c.id, system.catalog.digest(historical), randomUUID(), user.auth_version, plan])).rows[0];
        await freezeTaskCapabilities(tx, system.db.config, system.catalog, value);
        await freezeTaskSkills(tx, system.catalog, value);
        await reserve(tx, f.tenant, value.id, 1000000);
        await tx.query(`INSERT INTO desktop_executions(task_id,tenant_id,project_id,actor_id,device_id,local_session_id,
          native_family_id,workspace_hash,runtime_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [value.id, f.tenant, f.project, f.c.id, f.fields.device_id, f.fields.local_session_id, family.family_id,
          f.fields.workspace_hash, f.fields.runtime_sha256]);
        return value;
      }, f.tenant, true, f.c.id);
      await videoOK(s, f.c, "POST", f.base + "/desktop-executions/" + legacy.id + "/start", f.fields);
      task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [legacy.id])).rows[0];
    } finally { s.catalog.roles[index] = current; }
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
    await owner.connect(); await runMigrations(owner, "populated SQL101 audio consent upgrade", { throughVersion: 102 });
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
    assert.equal(view.accounting.cost_source, "company_tariff"); assert.equal(view.accounting.cost_confirmation_id, null);
    assert.equal(view.accounting.confirmed_micros, String(completed.actual_micros));
    assert.equal((await audio.preview(actor, f.tenant, f.project, retained.id, "audio")).sha256, hash(provider.bytes));
    const originalObject = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [asset.version.id])).rows[0];
    assert.deepEqual(await s.storage.get(originalObject.storage_key), provider.bytes);
    await runMigrations(owner, "unchanged SQL102 audio consent replay", { throughVersion: 102 });
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audio_authorizations")).rows[0].n, 0);
    await runMigrations(owner, "populated SQL102 shared guidance forward upgrade", { throughVersion: 103 });
    assert.equal((await owner.query("SELECT max(version) AS v FROM schema_migrations")).rows[0].v, 103);
    assert.deepEqual((await s.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=ANY($1) ORDER BY id", [ids])).rows,
      [...rows].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual((await s.db.control.query("SELECT input_context FROM tasks WHERE id=$1", [task.id])).rows[0].input_context, {});
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM project_configurations")).rows[0].n, 0);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audio_authorizations")).rows[0].n, 0);
    assert.deepEqual(await s.storage.get(originalObject.storage_key), provider.bytes);
    await runMigrations(owner, "unchanged SQL103 shared guidance replay", { throughVersion: 103 });
    assert.deepEqual((await s.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=$1", [retained.id])).rows[0], retained);
    await runMigrations(owner, "populated audio fixture upgrades through every current migration");
    const versions = (await readdir("migrations")).flatMap(name => /^([0-9]+)-.*\.sql$/.test(name) ? [Number(name.split("-")[0])] : []);
    assert.equal((await owner.query("SELECT max(version) AS v FROM schema_migrations")).rows[0].v, Math.max(...versions));
    assert.deepEqual((await s.db.control.query("SELECT * FROM ai_audio_jobs WHERE id=ANY($1) ORDER BY id", [ids])).rows,
      [...rows].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(await s.storage.get(originalObject.storage_key), provider.bytes);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audio_authorizations")).rows[0].n, 0);
    assert.equal(provider.calls.length, 0);
    const upgraded = await audio.read(actor, f.tenant, f.project, retained.id);
    assert.deepEqual(upgraded.accounting, view.accounting);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_audio_evidence")).rows[0].n, 0);
  } finally {
    await owner.end().catch(() => {});
    try { await s?.app.close(); } finally { try { await provider?.close(); } finally { await isolated.cleanup(); } }
  }
});
