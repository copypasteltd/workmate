import assert from "node:assert/strict";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
import {
  captureNativeSurfaces,
  directoryFiles,
  sha256,
} from "./native-surface-integrity.mjs";

const attempt = process.argv[2],
  nativeAttempt = process.argv[3];
assert.match(attempt ?? "", /^\d{2}$/);
assert.match(nativeAttempt ?? "", /^\d{2}$/);
const root = path.resolve(".."),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension"),
  prefix = `evidence/agent-adoption-artifacts-${attempt}`,
  options = {
    desktop,
    extension,
    packaged: true,
    executable: path.join(
      desktop,
      "release/adoption-54/win-unpacked/CopyPaste.exe",
    ),
  };
await assert.rejects(access(prefix + ".json"), (e) => e.code === "ENOENT");
const nativePath = `evidence/agent-adoption-native-${nativeAttempt}-journey.json`,
  report = JSON.parse(await readFile(nativePath, "utf8"));
assert.equal(report.status, "passed");
assert.deepEqual(report.errors, []);
assert.ok(
  report.desktop_closed &&
    report.browser_closed &&
    report.extension_closed &&
    report.owned_api_closed &&
    report.artifacts_unchanged_after_run,
);
assert.ok(report.checks.length >= 10);
assert.deepEqual(await captureNativeSurfaces(options), report.tested_artifacts);
const require = createRequire(import.meta.url),
  { extractFile } = await import(
    pathToFileURL(require.resolve("@electron/asar", { paths: [desktop] })).href
  ),
  archive = path.join(path.dirname(options.executable), "resources/app.asar"),
  embedded = [];
for (const dir of ["dist", "renderer-dist"]) {
  for (const f of await directoryFiles(path.join(desktop, dir))) {
    const relative = path.posix.join(dir, f),
      current = await readFile(path.join(desktop, relative)),
      actual = extractFile(archive, path.join(dir, f));
    assert.deepEqual(actual, current, "Packaged source mismatch: " + relative);
    embedded.push({
      path: relative,
      sha256: await sha256(path.join(desktop, relative)),
    });
  }
}
const entries = {};
for (const f of await directoryFiles(path.join(extension, "dist")))
  entries[f] = new Uint8Array(await readFile(path.join(extension, "dist", f)));
const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
assert.equal(manifest.side_panel.default_path, "sidepanel.html");
assert.equal(manifest.action.default_popup, undefined);
const zip = path.join(
  extension,
  "release/adoption-54/CopyPaste-0.5.0-sidepanel.zip",
);
await mkdir(path.dirname(zip), { recursive: true });
await writeFile(zip, zipSync(entries, { level: 6 }), { flag: "wx" });
const roundtrip = unzipSync(await readFile(zip));
assert.deepEqual(Object.keys(roundtrip).sort(), Object.keys(entries).sort());
for (const f of Object.keys(entries))
  assert.deepEqual(roundtrip[f], entries[f]);
const artifacts = [];
for (const [file, kind] of [
  [
    path.join(desktop, "release/adoption-54/CopyPaste-0.5.0-x64-Setup.exe"),
    "unsigned_windows_setup",
  ],
  [
    path.join(desktop, "release/adoption-54/CopyPaste-0.5.0-x64-Portable.exe"),
    "unsigned_windows_portable",
  ],
  [zip, "chrome_sidepanel_extension_zip"],
])
  artifacts.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    kind,
    bytes: (await stat(file)).size,
    sha256: await sha256(file),
  });
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
await writeFile(
  prefix + ".json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: "passed",
      scope:
        "New localhost native preview packages for explicit adoption and existing frameless/side-panel behavior; actual win-unpacked Desktop execution, not installation or store publication",
      signed: false,
      installed_or_published: false,
      default_origins: {
        api: "http://localhost:4310",
        web: "http://localhost:4317",
      },
      validation: {
        path: nativePath,
        sha256: await sha256(nativePath),
        checks: report.checks.length,
        tested_artifacts_match: true,
      },
      desktop_archive: {
        sha256: await sha256(archive),
        embedded_build_files: embedded,
      },
      extension_zip_matches_tested_dist: true,
      artifacts,
      verifier_sha256: await sha256(import.meta.filename),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({ passed: true, embedded_files: embedded.length, artifacts }),
);
