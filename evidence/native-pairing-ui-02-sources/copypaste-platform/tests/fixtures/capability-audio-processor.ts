/** An owned test processor used to prove recovery after a real process crash. */
import assert from "node:assert/strict";
import { buildApp } from "../../src/server.js";
import { CapabilityAudioVerification } from "../../src/capability-audio-verification.js";
import type { Config } from "../../src/config.js";
const id = process.argv[2]; assert.match(id!, /^[a-f0-9-]{36}$/);
const config = JSON.parse(process.env.COPYPASTE_AUDIO_PROCESSOR_FIXTURE_CONFIG!) as Config;
assert.equal(config.NODE_ENV, "test"); assert.equal(new URL(config.AI_BASE_URL!).hostname, "127.0.0.1");
assert.equal(config.AI_API_KEY, "synthetic-video-provider-fixture");
const system = await buildApp(config, { worker: false });
try { await new CapabilityAudioVerification(system.db, system.catalog).advance(undefined, id); }
finally { await system.app.close(); }
