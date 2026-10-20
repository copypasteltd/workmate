import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureNativeSurfaces,
  sha256,
} from "../../dev/copypaste-delivery/scripts/native-surface-integrity.mjs";

// Recheck only the delivered native clients. The backend has independent,
// potentially unfinished work and must not inherit an older UI qualification.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dev = path.join(root, "dev");
const desktop = path.join(dev, "copypaste-desktop");
const extension = path.join(dev, "copypaste-extension");
const delivery = path.join(dev, "copypaste-delivery");
const artifactPath = path.join(root, "docs/quality/agent-adoption-artifacts-02.json");
const artifacts = JSON.parse(await readFile(artifactPath, "utf8"));
assert.equal(artifacts.status, "passed");
assert.equal(artifacts.signed, false);
assert.equal(artifacts.installed_or_published, false);

function inside(base, relative) {
  const resolved = path.resolve(base, relative);
  assert.ok(resolved.startsWith(base + path.sep), "Path must stay within its repository");
  return resolved;
}

const reportPath = inside(delivery, artifacts.validation.path);
assert.equal(await sha256(reportPath), artifacts.validation.sha256);
const report = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(report.status, "passed");
assert.deepEqual(report.errors, []);
assert.equal(report.checks.length, artifacts.validation.checks);
assert.ok(report.checks.every((check) => check.status === "passed"));
for (const name of [
  "desktop_closed",
  "browser_closed",
  "extension_closed",
  "owned_api_closed",
  "artifacts_unchanged_after_run",
]) assert.equal(report[name], true, name);
assert.equal(report.inspection.desktop.no_application_menu, true);
assert.equal(report.inspection.desktop.menu_bar_visible, false);
assert.equal(report.inspection.extension.side, "right");
assert.equal(report.inspection.extension.native_context_type, "SIDE_PANEL");
assert.equal(report.inspection.extension.extra_popup_or_tab, false);
assert.ok(report.inspection.extension.main_width_after < report.inspection.extension.main_width_before);

const setup = artifacts.artifacts.find((item) => item.kind === "unsigned_windows_setup");
assert.ok(setup);
const runtime = path.join(path.dirname(inside(dev, setup.path)), "win-unpacked/CopyPaste.exe");
const current = await captureNativeSurfaces({ desktop, extension, executable: runtime, packaged: true });
assert.deepEqual(current, report.tested_artifacts, "Native source/build/runtime inputs changed since the actual UI run");
const manifest = JSON.parse(await readFile(path.join(extension, "dist/manifest.json"), "utf8"));
assert.equal(manifest.side_panel.default_path, "sidepanel.html");
assert.equal(manifest.action.default_popup, undefined);
assert.ok(manifest.permissions.includes("sidePanel"));

const verifiedArtifacts = [];
for (const item of artifacts.artifacts) {
  const target = inside(dev, item.path);
  assert.equal((await stat(target)).size, item.bytes);
  assert.equal(await sha256(target), item.sha256);
  verifiedArtifacts.push({ ...item, verified: true });
}

const result = {
  at: new Date().toISOString(),
  status: "passed",
  scope: "Read-only byte recheck of previously executed packaged frameless Desktop and real native Side Panel. No new browser/UI run, backend qualification, installation or publication.",
  prior_actual_ui_run: { at: report.at, checks: report.checks.length, report: artifacts.validation },
  desktop_source_files: current.desktop.source_files.length,
  extension_source_files: current.extension.source_files.length,
  desktop_runtime_files: current.desktop.runtime_files.length,
  extension_dist_files: current.extension.dist_files.length,
  source_build_runtime_match_prior_ui_run: true,
  verified_artifacts: verifiedArtifacts,
  browser_side: "right in the actual UI run; Chrome user settings control left/right placement",
  created_browser_or_app: false,
  artifact_manifest_sha256: await sha256(artifactPath),
  verifier_sha256: await sha256(fileURLToPath(import.meta.url)),
};
if (process.argv.length > 2) {
  assert.equal(process.argv.length, 4);
  assert.equal(process.argv[2], "--write");
  assert.match(process.argv[3], /^native-clients-recheck-[0-9]{8}(-[0-9]{2})?\.json$/);
  await writeFile(path.join(root, "docs/quality", process.argv[3]), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify(result, null, 2));
