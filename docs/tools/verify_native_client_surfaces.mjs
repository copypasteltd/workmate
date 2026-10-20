import assert from "node:assert/strict";
import { readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureNativeSurfaces, assertTestedSurfaces, sha256 } from "../../dev/copypaste-delivery/scripts/native-surface-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktop = path.join(root, "dev/copypaste-desktop");
const extension = path.join(root, "dev/copypaste-extension");
const evidence = path.join(root, "dev/copypaste-delivery/evidence/native-surfaces.json");
const report = JSON.parse(await readFile(evidence, "utf8"));
const current = await captureNativeSurfaces({desktop, extension,
  executable:path.join(desktop, "release/frameless/win-unpacked/CopyPaste.exe"), packaged:true});
assertTestedSurfaces(report, current);
const manifest = JSON.parse(await readFile(path.join(extension, "dist/manifest.json"), "utf8"));
assert.equal(manifest.side_panel?.default_path, "sidepanel.html");
assert.equal(manifest.action.default_popup, undefined);
assert.ok(manifest.permissions.includes("sidePanel"));
const artifacts = JSON.parse(await readFile(path.join(root,"docs/quality/native-surfaces-artifacts.json"),"utf8"));
const packages = [];
for (const artifact of artifacts.artifacts) {
  const target = path.resolve(root,"dev",artifact.path);
  assert.ok(target.startsWith(path.join(root,"dev") + path.sep));
  const bytes = (await stat(target)).size, digest = await sha256(target);
  assert.equal(bytes, artifact.bytes); assert.equal(digest, artifact.sha256);
  packages.push({...artifact, verified:true});
}
const heads = {};
for (const [name, repo] of [["desktop",desktop],["extension",extension]]) {
 heads[name] = execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","rev-parse","HEAD"],{cwd:repo,windowsHide:true,encoding:"utf8"}).trim();
}
const result = {at:new Date().toISOString(), scope:"Read-only source/runtime/installer/extension byte recheck of previously executed native surface QA; this command does not rerun UI, installation or backend qualification", status:"passed",
 original_ui_run_at:report.at, original_ui_checks:report.checks.length, original_ui_report_sha256:await sha256(evidence),
 client_source_files:{desktop:current.desktop.source_files.length,extension:current.extension.source_files.length},heads,
 clients_and_packages_match_ui_run:true, extension_manifest:{side_panel:manifest.side_panel,has_action_popup:false},
 original_ui_owned_cleanup:{desktop:report.desktop_closed,browser:report.browser_closed,extension:report.extension_closed},
 this_recheck_created_browser_or_app:false, packages, verifier_sha256:await sha256(fileURLToPath(import.meta.url))};
if(process.argv[2] === "--write") {
 const relative = process.argv[3];
 assert.match(relative ?? "", /^native-surfaces-request-recheck-[0-9]{8}\.json$/);
 await writeFile(path.join(root,"docs/quality",relative),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
} else assert.equal(process.argv.length,2,"Usage: node docs/tools/verify_native_client_surfaces.mjs [--write native-surfaces-request-recheck-YYYYMMDD.json]");
console.log(JSON.stringify(result,null,2));
