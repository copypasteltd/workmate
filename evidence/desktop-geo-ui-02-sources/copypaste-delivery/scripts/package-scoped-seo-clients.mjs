import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { zipSync } from "fflate";
import {
  captureNativeSurfaces,
  sha256,
  directoryFiles,
} from "./native-surface-integrity-seo.mjs";
const id = process.argv[2];
assert.match(id ?? "", /^\d{2}$/);
const root = path.resolve(".."),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension"),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const run = JSON.parse(
  await readFile(`evidence/scoped-seo-native-${id}-journey.json`, "utf8"),
);
assert.equal(run.status, "passed");
assert.ok(
  run.checks.length >= 20 &&
    run.checks.every((c) => c.status === "passed") &&
    run.errors.length === 0 &&
    run.desktop_closed &&
    run.browser_closed &&
    run.extension_closed &&
    run.artifacts_unchanged_after_run,
);
const tested = await captureNativeSurfaces({
  desktop,
  extension,
  executable: path.join(
    desktop,
    "release/scoped-seo-62-02/win-unpacked/CopyPaste.exe",
  ),
  packaged: true,
});
assert.deepEqual(tested, run.tested_artifacts);
const requireDesktop = createRequire(path.join(desktop, "package.json")),
  { extractFile } = await import(
    pathToFileURL(requireDesktop.resolve("@electron/asar")).href
  ),
  archive = path.join(
    desktop,
    "release/scoped-seo-62-02/win-unpacked/resources/app.asar",
  ),
  embedded = [];
for (const dir of ["dist", "renderer-dist"])
  for (const file of await directoryFiles(path.join(desktop, dir))) {
    const name = dir + "/" + file,
      bytes = await readFile(path.join(desktop, name)),
      actual = extractFile(archive, path.join(dir, file));
    assert.equal(sha(bytes), sha(actual));
    embedded.push({ path: name, sha256: sha(actual) });
  }
const files = await directoryFiles(path.join(extension, "dist")),
  entries = {};
for (const file of files)
  entries[file] = new Uint8Array(
    await readFile(path.join(extension, "dist", file)),
  );
const zip = path.join(
  extension,
  "release/scoped-seo-62-02/CopyPaste-0.5.0-sidepanel.zip",
);
await mkdir(path.dirname(zip), { recursive: true });
await writeFile(zip, zipSync(entries, { level: 9 }), { flag: "wx" });
const artifacts = [];
for (const [file, kind] of [
  [
    path.join(desktop, "release/scoped-seo-62-02/CopyPaste-0.5.0-x64-Setup.exe"),
    "unsigned_windows_setup",
  ],
  [
    path.join(
      desktop,
      "release/scoped-seo-62-02/CopyPaste-0.5.0-x64-Portable.exe",
    ),
    "unsigned_windows_portable",
  ],
  [zip, "chrome_mv3_native_sidepanel_zip"],
]) {
  const bytes = await readFile(file);
  artifacts.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    kind,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
}
const old = JSON.parse(
  await readFile(
    path.resolve("../../docs/quality/native-clients-recheck-20261021-02.json"),
    "utf8",
  ),
);
const stage59 = JSON.parse(
  await readFile(
    path.resolve("../../docs/quality/creative-matrix-artifacts.json"),
    "utf8",
  ),
);
const stage60 = JSON.parse(
  await readFile(
    path.resolve("../../docs/quality/template-video-artifacts.json"),
    "utf8",
  ),
);
for (const file of [
  ...old.verified_artifacts,
  ...stage59.artifacts,
  ...stage60.artifacts,
])
  assert.equal(
    await sha256(path.join(root, file.path)),
    file.sha256,
    "Prior client artifact was altered",
  );
const stage61 = JSON.parse(
  await readFile(
    path.resolve("../../docs/quality/marketing-connector-artifacts.json"),
    "utf8",
  ),
);
for (const file of stage61.artifacts)
  assert.equal(await sha256(path.join(root, file.path)), file.sha256);
const repositories = [];
for (const name of [
  "platform",
  "web",
  "admin",
  "desktop",
  "extension",
  "delivery",
]) {
  const dir = path.join(root, "copypaste-" + name);
  repositories.push({
    name,
    head: execFileSync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "rev-parse",
        "HEAD",
      ],
      { cwd: dir, encoding: "utf8", windowsHide: true },
    ).trim(),
  });
}
const report = {
  at: new Date().toISOString(),
  status: "passed",
  scope:
    "Unsigned localhost client previews. The unpacked Desktop executable and actual native Side Panel were executed; Setup/Portable installation, signing, store submission and production services were not qualified.",
  native_journey: {
    path: `evidence/scoped-seo-native-${id}-journey.json`,
    sha256: sha(
      await readFile(`evidence/scoped-seo-native-${id}-journey.json`),
    ),
  },
  actual_native_checks: run.checks.length,
  tested_artifacts: tested,
  embedded_files: embedded,
  extension_zip_entries: files,
  artifacts,
  prior_client_packages_unchanged: true,
  repositories,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile("evidence/scoped-seo-artifacts.json", bytes, {
  flag: "wx",
});
await writeFile(
  path.resolve("../../docs/quality/scoped-seo-artifacts.json"),
  bytes,
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: "passed",
    artifacts: artifacts.length,
    native_checks: run.checks.length,
    embedded_files: embedded.length,
    zip_entries: files.length,
  }),
);
