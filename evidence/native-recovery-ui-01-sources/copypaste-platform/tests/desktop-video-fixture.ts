import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { buildApp } from "../src/server.js";
import { defaults } from "../src/plans.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { hash } from "../src/lib.js";
import { desktopImageFixture } from "./desktop-image-fixture.js";
import { saveAsset } from "../src/storage.js";

export type VideoSystem = Awaited<ReturnType<typeof buildApp>>;
export interface VideoClient { id: string; cookie?: string; csrf?: string; access_token?: string }
export async function videoCall(s: VideoSystem, client: VideoClient | undefined, method: string, url: string, body?: unknown, requestKey: string = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: {
    ...(client?.cookie ? { cookie: client.cookie, "x-csrf-token": client.csrf! } : {}),
    ...(client?.access_token ? { Authorization: "Bearer " + client.access_token } : {}),
    "Idempotency-Key": requestKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
export async function videoOK(s: VideoSystem, client: VideoClient | undefined, method: string, url: string, body?: unknown, requestKey?: string) {
  const result = await videoCall(s, client, method, url, body, requestKey);
  assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
}
export async function videoActor(s: VideoSystem) {
  const challenge = await videoOK(s, undefined, "POST", "/v1/auth/challenge", { email: "native-video-" + randomUUID() + "@example.invalid" });
  const mail = JSON.parse(await readFile(s.db.config.DATA_DIR + "/mailbox/" + challenge.challenge_id + ".json", "utf8"));
  const signed = await videoCall(s, undefined, "POST", "/v1/auth/verify", { challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  assert.equal(signed.status, 200);
  const web: VideoClient = { id: signed.data.user.id, csrf: signed.data.csrf_token, cookie: signed.raw.cookies[0].name + "=" + signed.raw.cookies[0].value };
  const verifier = randomBytes(32).toString("base64url"), redirect = "http://127.0.0.1:18249/callback";
  const authorization = await videoOK(s, web, "POST", "/v1/auth/native/authorize", { client_id: "desktop", redirect_uri: redirect,
    state: randomBytes(32).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const token = await videoOK(s, undefined, "POST", "/v1/auth/native/token", { client_id: "desktop", redirect_uri: redirect,
    code: new URL(authorization.redirect).searchParams.get("code"), code_verifier: verifier });
  return { web, c: { id: web.id, access_token: token.access_token } as VideoClient };
}
export async function nativeVideoFixture(s: VideoSystem) {
  const actor = await videoActor(s);
  const workspace = await videoOK(s, actor.web, "POST", "/v1/tenants", { name: "Native video fixture", project_name: "Private production" });
  const tenant = workspace.tenant.id, project = workspace.project.id;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Native video fixture',$2)", [tenant, defaults.business]);
  const fields = { device_id: randomUUID(), local_session_id: randomUUID(), workspace_hash: hash("native-video-" + randomUUID()),
    runtime_version: desktopRuntime.pinned_version, runtime_sha256: desktopRuntime.windows_x64_sha256 };
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  return { ...actor, tenant, project, base, fields };
}
export type VideoFixture = Awaited<ReturnType<typeof nativeVideoFixture>>;
export async function startNativeVideo(s: VideoSystem, fixture: VideoFixture, extra: Record<string, unknown> = {}) {
  const task = await videoOK(s, fixture.c, "POST", fixture.base + "/desktop-executions", { ...fixture.fields,
    title: "Private local video", prompt: "Make an explicitly synthetic video fixture using company composition.", role_key: "video-motion", budget_micros: 1000000, ...extra });
  const url = fixture.base + "/desktop-executions/" + task.task_id;
  const started = await videoOK(s, fixture.c, "POST", url + "/start", fixture.fields);
  return { task, started, url };
}
export function videoDefinitionFixture(asset?: { asset_id: string; version: number }, headline = "A clearer launch") {
  return {
    schema_version: "copypaste-video-1", template: "campaign-cuts-1", locale: "en", width: 480, height: 270,
    frame_rate: { numerator: 24, denominator: 1 }, duration_frames: 72,
    script: { title: "CopyPaste native video", brief: "Explicit synthetic marketing fixture", narration: "", call_to_action: "Make room for better work" },
    brand: { label: "COPYPASTE", background: "#F4F6FA", ink: "#1A2B46", accent: "#3152CC", logo: null },
    storyboard: [{ key: "opening", start_frame: 0, end_frame: 36, direction: "Synthetic product card", headline, body: "CopyPaste Workmate", image: asset ?? null },
      { key: "closing", start_frame: 36, end_frame: 72, direction: "Synthetic offer and closing", headline: "HK$ 299", body: "Your next launch, together", image: asset ?? null }],
    subtitles: [{ key: "caption", start_frame: 0, end_frame: 60, text: headline }], audio: null,
  };
}
export async function videoSourceFixture(s: VideoSystem, f: VideoFixture, taskId?: string) {
  return s.db.tx(async tx => {
    if (taskId) await tx.query("SELECT set_config('app.task_id',$1,true)", [taskId]);
    return saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.c.id, name: "native-video-source.png",
      mime: "image/png", kind: "fixture_source", bytes: desktopImageFixture() });
  }, f.tenant, false, f.c.id);
}
export function videoToolRequest(tool: string, args: unknown, callId = "video_" + randomUUID()) {
  return { tool, arguments: args, call_id: callId, thread_id: "actual-video-thread-fixture", turn_id: "actual-video-turn-fixture" };
}
export const videoFinish = { status: "completed", output: "Explicitly queued or observed native video result", thread_id: "actual-video-thread-fixture", turn_id: "actual-video-turn-fixture" };
