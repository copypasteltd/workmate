import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

const execute = promisify(execFile), binary = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(binary && path.isAbsolute(binary), "An absolute locked native Codex path is required");
const manifestFile = "contracts/local-codex-runtime.json", manifest = JSON.parse(await readFile(manifestFile));
const binaryHash = createHash("sha256");
for await (const chunk of createReadStream(binary)) binaryHash.update(chunk);
assert.equal(binaryHash.digest("hex"), manifest.windows_x64_sha256);
const { stdout } = await execute(binary, ["--version"], { windowsHide: true, timeout: 10000 });
assert.equal(stdout.trim(), "codex-cli " + manifest.runtime_version);
const scratch = path.resolve(".data/local-codex-schema", randomUUID());
await execute(binary, ["app-server", "generate-json-schema", "--out", scratch, "--experimental"], { windowsHide: true, timeout: 30000 });
const selected = ["v2/ThreadStartParams.json", "v2/ThreadStartResponse.json", "v2/ThreadResumeResponse.json", "v2/TurnStartParams.json", "CommandExecutionRequestApprovalResponse.json"];
const schemas = {};
for (const name of selected) {
  const bytes = await readFile(path.join(scratch, name)), target = path.join("contracts/codex", name);
  JSON.parse(bytes);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  schemas[name] = createHash("sha256").update(bytes).digest("hex");
}
manifest.schema_sources = { generator_version: manifest.runtime_version, experimental: true, sha256: schemas };
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ version: manifest.runtime_version, copied_schemas: selected.length, binary_sha256: manifest.windows_x64_sha256 }));
