import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { packageFiles, digest, validateNativeBundle } from "./package-contract.mjs";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const root = fileURLToPath(new URL("../", import.meta.url)), output = path.join(root, ".data/native-node-distributions", attempt);
await mkdir(path.dirname(output), { recursive: true }); await mkdir(output, { recursive: false });
const files = {};
for (const name of packageFiles) { const source = path.join(root, name); assert.ok((await lstat(source)).isFile()); const bytes = await readFile(source); files[name] = { mode: 0o644, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") }; }
const bundle = Buffer.from(JSON.stringify({ format: "copypaste-native-cloud-node-1", version: "1.0.0", platforms: ["linux-x64", "linux-arm64"], minimum_node_major: 22, files }, null, 2) + "\n"), sha256 = digest(bundle);
validateNativeBundle(bundle, sha256);
await writeFile(path.join(output, "node-source-bundle.json"), bundle, { flag: "wx" });
await writeFile(path.join(output, "receipt.json"), JSON.stringify({ at: new Date().toISOString(), status: "source_bundle_built", file: "node-source-bundle.json", sha256, bytes: bundle.length, sources: Object.fromEntries(Object.entries(files).map(([name, row]) => [name, row.sha256])), physical_linux_execution_qualified: false, compiled_guard_included: false, credentials_included: false, virtualization_used: false }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "source_bundle_built", files: packageFiles.length, sha256, bytes: bundle.length, physical_linux_execution_qualified: false }));
