import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  captureNativeSurfaces,
  assertTestedSurfaces,
  sha256,
} from "./native-surface-integrity.mjs";

// Refresh only the receipt binding after rechecking the same native binaries.
// package-native-surfaces.mjs remains the path that creates new release files.
const workspace = path.resolve("../.."),
  dev = path.join(workspace, "dev"),
  delivery = path.join(dev, "copypaste-delivery"),
  desktop = path.join(dev, "copypaste-desktop"),
  extension = path.join(dev, "copypaste-extension"),
  manifestPath = path.join(delivery, "evidence/native-surfaces-artifacts.json"),
  previousBytes = await readFile(manifestPath),
  previous = JSON.parse(previousBytes),
  reportPath = path.join(delivery, previous.validation.path),
  report = JSON.parse(await readFile(reportPath, "utf8")),
  current = await captureNativeSurfaces({
    desktop,
    extension,
    executable: path.join(desktop, "release/frameless/win-unpacked/CopyPaste.exe"),
    packaged: true,
  });
assertTestedSurfaces(report, current);
assert.equal(previous.signed, false);
assert.equal(previous.installed_or_published, false);
assert.equal(previous.artifacts.length, 3);
for (const artifact of previous.artifacts) {
  const file = path.resolve(dev, artifact.path),
    relative = path.relative(dev, file);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal((await stat(file)).size, artifact.bytes);
  assert.equal(await sha256(file), artifact.sha256);
}
const archive = path.join(desktop, "release/frameless/win-unpacked/resources/app.asar");
assert.equal(await sha256(archive), previous.desktop_archive.sha256);
const require = createRequire(import.meta.url),
  { extractFile } = await import(
    pathToFileURL(require.resolve("@electron/asar", { paths: [desktop] })).href
  ),
  { createHash } = await import("node:crypto");
for (const file of previous.desktop_archive.embedded_build_files) {
  assert.equal(await sha256(path.join(desktop, file.path)), file.sha256);
  assert.equal(
    createHash("sha256").update(extractFile(archive, path.normalize(file.path))).digest("hex"),
    file.sha256,
  );
}
const newDigest = await sha256(reportPath);
if (newDigest === previous.validation.sha256) {
  console.log(JSON.stringify({ unchanged_artifacts: 3, already_current: true }));
  process.exit(0);
}
const historicalReceipt = path.join(
  delivery,
  "evidence/stage48-before-vip-credit-combination/dev/copypaste-delivery/evidence/native-surfaces.json",
);
assert.equal(await sha256(historicalReceipt), previous.validation.sha256);
const archiveDir = path.join(delivery, "evidence/vip-credit-native-binding");
await mkdir(archiveDir, { recursive: true });
const preserved = path.join(archiveDir, "artifacts-before.json");
await writeFile(preserved, previousBytes, { flag: "wx" });
const source = path.relative(workspace, manifestPath).replaceAll("\\", "/"),
  archived = path.relative(workspace, preserved).replaceAll("\\", "/");
await writeFile(
  path.join(archiveDir, "archive-map.json"),
  JSON.stringify(
    {
      scope: "Exact artifact manifest before binding the same three unchanged native preview files to the current ten-check receipt. Prior receipt remains in the stage 48 archive; original build repositories and timestamp are preserved.",
      files: [{ source, archived, sha256: await sha256(preserved) }],
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
const result = {
  ...previous,
  validation: { ...previous.validation, sha256: newDigest },
  validation_history: [
    ...(previous.validation_history ?? []),
    {
      ...previous.validation,
      original_path: previous.validation.path,
      path: path.relative(delivery, historicalReceipt).replaceAll("\\", "/"),
    },
  ],
  validation_checked_at: new Date().toISOString(),
  validation_refresh_verifier_sha256: await sha256(new URL(import.meta.url)),
  native_artifacts_rebuilt: false,
};
assertTestedSurfaces(
  report,
  await captureNativeSurfaces({
    desktop,
    extension,
    executable: path.join(desktop, "release/frameless/win-unpacked/CopyPaste.exe"),
    packaged: true,
  }),
);
await writeFile(manifestPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ unchanged_artifacts: 3, receipt_checks: 10, embedded_files: previous.desktop_archive.embedded_build_files.length, native_artifacts_rebuilt: false }));
