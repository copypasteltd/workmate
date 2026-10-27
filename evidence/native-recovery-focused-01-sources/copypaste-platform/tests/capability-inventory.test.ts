import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { nativeVideoFixture } from "./desktop-video-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { videoJobProtocol } from "../src/video-job-protocol.js";
import {
  speechProtocol,
  transcriptionProtocol,
} from "../src/audio-production-model.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>,
  f: Awaited<ReturnType<typeof nativeVideoFixture>>;
before(async () => {
  owned = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...owned.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      AI_BASE_URL: "http://127.0.0.1:1/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "synthetic-no-call-inventory-fixture",
      AI_MODEL: "synthetic-reasoning",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "100",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "100",
      AI_IMAGE_MODEL: "synthetic-image",
      AI_IMAGE_VERIFIED: "false",
      AI_IMAGE_HKD_MICROS_PER_IMAGE: "100",
      AI_VIDEO_MODEL: "synthetic-video",
      AI_VIDEO_VERIFIED: "true",
      AI_VIDEO_HKD_MICROS_PER_SECOND: "100",
      AI_SPEECH_MODEL: "synthetic-speech",
      AI_SPEECH_VERIFIED: "true",
      AI_SPEECH_VOICES: "alloy",
      AI_SPEECH_LOCALES: "en",
      AI_SPEECH_HKD_MICROS_PER_CHARACTER: "100",
      AI_TRANSCRIPTION_MODEL: "synthetic-transcription",
      AI_TRANSCRIPTION_VERIFIED: "true",
      AI_TRANSCRIPTION_LOCALES: "en",
      AI_TRANSCRIPTION_HKD_MICROS_PER_MILLISECOND: "5",
    }),
    { worker: false },
  );
  f = await nativeVideoFixture(s);
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await owned?.cleanup();
  }
});
async function read(
  url = "/v1/capabilities/details",
  actor = f.c,
  tenant = f.tenant,
) {
  const raw = await s.app.inject({
    method: "GET",
    url,
    headers: {
      authorization: "Bearer " + actor.access_token,
      "x-tenant-id": tenant,
    },
  });
  return { status: raw.statusCode, body: raw.json() };
}

test("configured media inventory uses each exact implemented protocol and its own verification flag", async () => {
  const response = await read();
  assert.equal(response.status, 200);
  const items = new Map<string, any>(
    response.body.items.map((item: any) => [item.id, item]),
  );
  assert.equal(items.size, 5);
  assert.equal(items.get("internal-image2-v1").state, "unverified");
  for (const [id, protocol] of [
    ["internal-video-v1", videoJobProtocol],
    ["internal-speech-v1", speechProtocol],
    ["internal-transcription-v1", transcriptionProtocol],
  ]) {
    assert.equal(items.get(id).state, "verified", id);
    assert.equal(items.get(id).wire_protocol, protocol);
    assert.equal(items.get(id).rates.length, 1);
  }
  assert.equal(items.get("internal-text-v1").state, "verified");
  assert.ok(!JSON.stringify(response.body).includes(s.db.config.AI_API_KEY!));
  assert.ok(!JSON.stringify(response.body).includes(s.db.config.AI_BASE_URL!));
});

test("changing any profile verification invalidates a signed page and never inherits another media flag", async () => {
  for (const [flag, id] of [
    ["AI_VIDEO_VERIFIED", "internal-video-v1"],
    ["AI_SPEECH_VERIFIED", "internal-speech-v1"],
    ["AI_TRANSCRIPTION_VERIFIED", "internal-transcription-v1"],
  ] as const) {
    const before = await read("/v1/capabilities/details?limit=1");
    assert.equal(before.status, 200);
    assert.ok(before.body.next_cursor);
    const original = s.db.config[flag];
    s.db.config[flag] = false;
    try {
      const stale = await read(
        "/v1/capabilities/details?limit=1&cursor=" +
          encodeURIComponent(before.body.next_cursor),
      );
      assert.equal(stale.status, 410);
      assert.equal(stale.body.error.code, "CURSOR_EXPIRED");
      const current = await read();
      assert.equal(current.status, 200);
      assert.equal(
        current.body.items.find((item: any) => item.id === id).state,
        "unverified",
      );
      assert.equal(
        current.body.items.find((item: any) => item.id === "internal-text-v1")
          .state,
        "verified",
      );
    } finally {
      s.db.config[flag] = original;
    }
  }
});

test("gateway changes degrade implemented media while revocation disables the exact version", async () => {
  const original = s.db.config.AI_BASE_URL;
  s.db.config.AI_BASE_URL = "http://127.0.0.1:2/v1";
  try {
    const result = await read();
    assert.equal(result.status, 200);
    assert.ok(
      result.body.items.every((item: any) => item.state === "degraded"),
    );
  } finally {
    s.db.config.AI_BASE_URL = original;
  }
  const version = s.catalog.capabilityVersions.get("internal-speech-v1")!;
  await s.db.control.query(
    "UPDATE internal_capability_versions SET revoked=true WHERE id=$1",
    [version.id],
  );
  const result = await read();
  assert.equal(result.status, 200);
  assert.equal(
    result.body.items.find((item: any) => item.id === "internal-speech-v1")
      .state,
    "disabled",
  );
  assert.equal(
    result.body.items.find((item: any) => item.id === "internal-video-v1")
      .state,
    "verified",
  );
});

test("capability inventory remains tenant-scoped and anonymous callers cannot read it", async () => {
  const anonymous = await s.app.inject({
    method: "GET",
    url: "/v1/capabilities",
    headers: { "x-tenant-id": f.tenant },
  });
  assert.equal(anonymous.statusCode, 401);
  const outsider = await nativeVideoFixture(s);
  const denied = await read("/v1/capabilities", outsider.c);
  assert.equal(denied.status, 404);
});
