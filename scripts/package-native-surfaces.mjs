import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import {
  captureNativeSurfaces,
  assertTestedSurfaces,
} from "./native-surface-integrity.mjs";

const exec = promisify(execFile),
  root = path.resolve(".."),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension");
async function walk(dir, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(dir, relative), {
    withFileTypes: true,
  })) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(dir, next)));
    else if (entry.isFile()) files.push(next);
    else throw new Error("Unexpected non-file artifact: " + next);
  }
  return files.sort();
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
const repositories = [];
for (const name of [
  "copypaste-platform",
  "copypaste-web",
  "copypaste-desktop",
  "copypaste-extension",
  "copypaste-delivery",
]) {
  const cwd = path.join(root, name),
    status = (
      await exec("git", ["status", "--porcelain"], { cwd, windowsHide: true })
    ).stdout.trim();
  assert.equal(
    status,
    "",
    "Commit source and evidence before recording artifact provenance: " + name,
  );
  repositories.push({
    name,
    head: (
      await exec("git", ["rev-parse", "HEAD"], { cwd, windowsHide: true })
    ).stdout.trim(),
  });
}
const report = JSON.parse(
  await readFile("evidence/native-surfaces.json", "utf8"),
);
assert.equal(report.inspection.desktop.executable_kind, "packaged");
assert.equal(report.checks.length, 10);
assert.ok(report.checks.every((c) => c.status === "passed"));
assert.deepEqual(report.errors, []);
assert.ok(
  report.desktop_closed && report.browser_closed && report.extension_closed,
);
// A historical green report must never qualify different client binaries.
const testedArtifacts = await captureNativeSurfaces({
  desktop,
  extension,
  executable: path.join(
    desktop,
    "release/frameless/win-unpacked/CopyPaste.exe",
  ),
  packaged: true,
});
assertTestedSurfaces(report, testedArtifacts);
const require = createRequire(import.meta.url),
  { extractFile } = await import(
    pathToFileURL(require.resolve("@electron/asar", { paths: [desktop] })).href
  );
const archive = path.join(
    desktop,
    "release/frameless/win-unpacked/resources/app.asar",
  ),
  embedded = [];
for (const dir of ["dist", "renderer-dist"]) {
  for (const file of await walk(path.join(desktop, dir))) {
    const relative = path.posix.join(dir, file),
      expected = digest(await readFile(path.join(desktop, relative))),
      actual = digest(extractFile(archive, path.join(dir, file)));
    assert.equal(
      actual,
      expected,
      "Packaged code differs from current build: " + relative,
    );
    embedded.push({ path: relative, sha256: actual });
  }
}
const entries = {};
for (const file of await walk(path.join(extension, "dist")))
  entries[file] = new Uint8Array(
    await readFile(path.join(extension, "dist", file)),
  );
const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
assert.equal(manifest.side_panel.default_path, "sidepanel.html");
assert.equal(manifest.action.default_popup, undefined);
await mkdir(path.join(extension, "release/sidepanel"), { recursive: true });
const zip = path.join(
  extension,
  "release/sidepanel/CopyPaste-0.5.0-sidepanel.zip",
);
await writeFile(zip, zipSync(entries, { level: 6 }));
const artifacts = [];
for (const [file, kind] of [
  [
    path.join(desktop, "release/frameless/CopyPaste-0.5.0-x64-Setup.exe"),
    "unsigned_windows_setup",
  ],
  [
    path.join(desktop, "release/frameless/CopyPaste-0.5.0-x64-Portable.exe"),
    "unsigned_windows_portable",
  ],
  [zip, "unpacked_chrome_extension_zip"],
]) {
  artifacts.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    kind,
    bytes: (await stat(file)).size,
    sha256: await fileDigest(file),
  });
}
const result = {
  at: new Date().toISOString(),
  scope:
    "Separate native-surface client previews, not the complete historical offline release or production acceptance",
  version: "0.5.0",
  default_origins: {
    api: "http://localhost:4310",
    web: "http://localhost:4317",
  },
  signed: false,
  installed_or_published: false,
  repositories,
  validation: {
    path: "evidence/native-surfaces.json",
    sha256: await fileDigest("evidence/native-surfaces.json"),
    checks: report.checks.length,
    tested_artifacts_match: true,
    desktop_execution:
      "win-unpacked; Setup and Portable have byte provenance but were not installed by this check",
  },
  desktop_archive: {
    sha256: await fileDigest(archive),
    embedded_build_files: embedded,
  },
  artifacts,
};
assertTestedSurfaces(
  report,
  await captureNativeSurfaces({
    desktop,
    extension,
    executable: path.join(
      desktop,
      "release/frameless/win-unpacked/CopyPaste.exe",
    ),
    packaged: true,
  }),
);
await writeFile(
  "evidence/native-surfaces-artifacts.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({ embedded_build_files: embedded.length, artifacts }, null, 2),
);
