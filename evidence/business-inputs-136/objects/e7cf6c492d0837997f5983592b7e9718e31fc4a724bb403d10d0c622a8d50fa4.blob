/** Execute the actual compiled audio verifier from an unrelated owned cwd. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), prefix = "evidence/managed-audio-build-" + attempt;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", ".log", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const files = ["scripts/copy-cloud-check-bootstrap.mjs", "src/capability-audio-plan.ts", "src/capability-verification.ts",
  "assets/audio/LICENSE.txt", "assets/audio/protocol-tone-v1.wav", "assets/audio/protocol-tone-v1.mp3", "package.json", "tsconfig.json"];
const sources = {};
for (const name of files) {
  const bytes = await readFile(path.join(platform, name)), key = "copypaste-platform/" + name;
  sources[key] = sha(bytes);
  const target = path.resolve(prefix + "-sources", key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const module = pathToFileURL(path.join(platform, "dist/src/capability-audio-plan.js")).href;
const compiled = { path: "copypaste-platform/dist/src/capability-audio-plan.js", sha256: sha(await readFile(new URL(module))) };
const owned = path.resolve(".data/managed-audio-build", randomUUID()); await mkdir(owned, { recursive: true });
const program = `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const { capabilityAudioReference } = await import(${JSON.stringify(module)});
const probes = [];
for (const mime of ['audio/wav', 'audio/mpeg']) {
  const value = await capabilityAudioReference(mime);
  assert.ok(value.bytes.length > 0);
  assert.equal(createHash('sha256').update(value.bytes).digest('hex'), value.sha256);
  const decoded = spawnSync('ffmpeg', ['-v','error','-xerror','-err_detect','explode','-i','pipe:0','-map','0:a:0','-f','null','-'], { input:value.bytes, windowsHide:true, timeout:30000 });
  assert.ifError(decoded.error); assert.equal(decoded.status,0,decoded.stderr.toString()); assert.equal(decoded.stderr.length,0);
  probes.push({ mime_type:mime, sha256:value.sha256, bytes:value.bytes.length, fully_decoded:true });
}
const license = await readFile(new URL('../assets/audio/LICENSE.txt', ${JSON.stringify(module)}));
assert.equal(license.toString(), ${JSON.stringify((await readFile(path.join(platform, 'assets/audio/LICENSE.txt'))).toString())});
console.log(JSON.stringify({ compiled_runtime:true, unrelated_owned_cwd:true, source_ts_loader:false, probes, license_sha256:createHash('sha256').update(license).digest('hex') }));
`;
let exit = 0, stdout = "", stderr = "";
try {
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", program], { cwd: owned, windowsHide: true, timeout:90000, maxBuffer:2_000_000 });
  stdout = result.stdout; stderr = result.stderr;
} catch (error) { exit = Number.isInteger(error.code) ? error.code : 1; stdout = error.stdout ?? ""; stderr = error.stderr ?? String(error); }
const raw = Buffer.from(stdout + stderr); await writeFile(prefix + ".log", raw, { flag: "wx" });
let result; if (exit === 0) result = JSON.parse(stdout.trim());
const stable = (await Promise.all(files.map(async name => sha(await readFile(path.join(platform, name))) === sources["copypaste-platform/" + name]))).every(Boolean)
  && compiled.sha256 === sha(await readFile(new URL(module)));
const passed = exit === 0 && stable && result?.compiled_runtime && result?.unrelated_owned_cwd && result?.source_ts_loader === false && result?.probes.length === 2;
await writeFile(prefix + ".json", JSON.stringify({ at:new Date().toISOString(), status:passed ? "passed":"failed", source_unchanged:stable,
  test_exit:exit, source_files:sources, compiled, result:result ?? null, raw_log:{path:prefix + ".log",sha256:sha(raw)}, verifier_sha256:sha(await readFile(import.meta.filename)),
  scope:"Actual compiled reference loading, pinned original asset hashes, full native decoding and bundled license from an unrelated owned cwd. No TypeScript loader or provider call." }, null, 2) + "\n", { flag:"wx" });
console.log(JSON.stringify({ status:passed ? "passed":"failed", test_exit:exit, source_unchanged:stable, error:stderr ? stderr.slice(0,500):null }));
process.exitCode = passed ? 0:1;
