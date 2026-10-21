// Read-only check of the exact clients exercised in the stage 59 native journey.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dev = path.join(root, "dev"), delivery = path.join(dev, "copypaste-delivery");
const desktop = path.join(dev, "copypaste-desktop"), extension = path.join(dev, "copypaste-extension");
const id = process.argv[2];
assert.match(id ?? "", /^\d{2}$/);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(path.join(root, "docs/quality/creative-matrix-artifacts.json"));
assert.deepEqual(manifestBytes, await readFile(path.join(delivery, "evidence/creative-matrix-artifacts.json")));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.status, "passed");
const journeyBytes = await readFile(path.join(delivery, manifest.native_journey.path));
assert.equal(sha(journeyBytes), manifest.native_journey.sha256);
const journey = JSON.parse(journeyBytes);
assert.equal(journey.status, "passed");
assert.equal(journey.checks.length, 13);
assert.equal(journey.errors.length, 0);
assert.ok(journey.desktop_closed && journey.extension_closed && journey.browser_closed && journey.owned_api_closed);
const { captureNativeSurfaces } = await import(pathToFileURL(path.join(delivery, "scripts/native-surface-integrity.mjs")));
const current = await captureNativeSurfaces({ desktop, extension, packaged: true,
  executable: path.join(desktop, "release/matrices-59-02/win-unpacked/CopyPaste.exe") });
assert.deepEqual(current, manifest.tested_artifacts);
assert.deepEqual(current, journey.tested_artifacts);
for (const artifact of manifest.artifacts)
  assert.equal(sha(await readFile(path.join(dev, artifact.path))), artifact.sha256);
const previous = JSON.parse(await readFile(path.join(root, "docs/quality/native-clients-recheck-20261021-02.json"), "utf8"));
for (const artifact of previous.verified_artifacts)
  assert.equal(sha(await readFile(path.join(dev, artifact.path))), artifact.sha256);
const desktopRequire = createRequire(path.join(desktop, "package.json"));
const { extractFile } = await import(pathToFileURL(desktopRequire.resolve("@electron/asar")));
const archive = path.join(desktop, "release/matrices-59-02/win-unpacked/resources/app.asar");
for (const entry of manifest.embedded_files) {
  assert.equal(sha(extractFile(archive, path.join(...entry.path.split("/")))), entry.sha256);
  assert.equal(sha(await readFile(path.join(desktop, entry.path))), entry.sha256);
}
const deliveryRequire = createRequire(path.join(delivery, "package.json"));
const { unzipSync } = await import(pathToFileURL(deliveryRequire.resolve("fflate")));
const zip = manifest.artifacts.find((entry) => entry.kind === "chrome_mv3_native_sidepanel_zip");
assert.ok(zip);
const entries = unzipSync(await readFile(path.join(dev, zip.path)));
assert.deepEqual(Object.keys(entries).sort(), [...manifest.extension_zip_entries].sort());
for (const [name, bytes] of Object.entries(entries))
  assert.deepEqual(Buffer.from(bytes), await readFile(path.join(extension, "dist", name)));
const report = { at: new Date().toISOString(), status: "passed",
  scope: "Read-only current source, unpacked runtime, embedded code, extension ZIP contents and artifact verification against the actual 13-check native journey; no new application/browser launch or installation acceptance",
  verifier_sha256: sha(await readFile(fileURLToPath(import.meta.url))),
  manifest_sha256: sha(manifestBytes), native_journey_sha256: sha(journeyBytes),
  native_checks: journey.checks.length, artifacts: manifest.artifacts,
  embedded_files: manifest.embedded_files.length, extension_zip_entries: Object.keys(entries).length,
  previous_client_artifacts_unchanged: true, browsers_or_apps_started: false };
await writeFile(path.join(root, `docs/quality/creative-matrix-client-recheck-${id}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "passed", native_checks: 13, artifacts: manifest.artifacts.length,
  embedded_files: report.embedded_files, extension_zip_entries: report.extension_zip_entries, browsers_or_apps_started: false }));
