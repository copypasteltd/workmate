import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile, writeFile, realpath, lstat, mkdir, mkdtemp, open, unlink} from "node:fs/promises";
import path from "node:path";

const execute = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const allowed = new Set([
  "START-HERE.md",
  "docs/releases/v0.1.0-rc.3-onboarding-162.md",
  "dev/copypaste-delivery/package.json",
  "dev/copypaste-delivery/scripts/bootstrap-source-demo-158.mjs",
  "dev/copypaste-delivery/scripts/source-demo-port-preflight-162.mjs",
  "dev/copypaste-delivery/scripts/source-preflight-162.mjs",
]);

/** Reject links/reparse junctions and any path outside the explicitly selected
 * source root before Git is allowed to read or modify patch destinations. */
async function target(root, relative) {
  assert.ok(relative && !path.isAbsolute(relative) && !relative.includes("\\") && !relative.split("/").some(p => !p || p === "." || p === ".."));
  const result = path.resolve(root, relative);
  const within = path.relative(root, result);
  assert.ok(within && !path.isAbsolute(within) && within !== ".." && !within.startsWith(".." + path.sep));
  let current = root;
  for (const [i, part] of relative.split("/").entries()) {
    current = path.join(current, part);
    try {
      const s = await lstat(current);
      assert.equal(s.isSymbolicLink(), false, "Patch paths cannot contain links or junctions");
      if (i < relative.split("/").length - 1) assert.ok(s.isDirectory());
      else assert.ok(s.isFile() || s.isDirectory());
    } catch(e) {
      if (e.code === "ENOENT") break;
      throw e;
    }
  }
  return result;
}

async function main() {
  assert.equal(process.argv.length, 3, "Use node apply-onboarding-patch-162.mjs <absolute extracted rc.3 source root>");
  assert.ok(path.isAbsolute(process.argv[2]), "Select an absolute source root");
  const root = await realpath(process.argv[2]);
  const manifest = JSON.parse(await readFile(path.join(import.meta.dirname, "patch-manifest.json"), "utf8"));
  assert.equal(manifest.base_release, "v0.1.0-rc.3");
  assert.equal(manifest.patch_file, "onboarding-162.patch");
  assert.equal(manifest.files.length, allowed.size);
  assert.deepEqual(new Set(manifest.files.map(f => f.path)), allowed);
  assert.equal(hash(await readFile(import.meta.filename)), manifest.applier_sha256);
  const patch = path.join(import.meta.dirname, manifest.patch_file);
  assert.equal(hash(await readFile(patch)), manifest.patch_sha256, "Patch bytes changed");
  for (const component of ["platform", "web", "admin", "desktop", "extension", "delivery"]) {
    const file = await target(root, "dev/copypaste-" + component + "/package.json");
    const p = JSON.parse(await readFile(file, "utf8"));
    assert.ok(p.name?.startsWith("@copypaste/"), "Keep the six extracted source directories together");
  }
  const observed = [];
  for (const entry of manifest.files) {
    assert.ok(/^[a-f\d]{64}$/.test(entry.after_sha256));
    assert.ok(entry.before_sha256 === null || /^[a-f\d]{64}$/.test(entry.before_sha256));
    const file = await target(root, entry.path);
    let actual = null;
    try {actual = hash(await readFile(file));} catch(e) {if(e.code !== "ENOENT") throw e;}
    observed.push({entry, file, actual});
  }
  if (observed.every(v => v.actual === v.entry.after_sha256)) {
    console.log(JSON.stringify({status: "already_applied", release: manifest.base_release, files: observed.length}));
    return;
  }
  assert.ok(observed.every(v => v.actual === v.entry.before_sha256), "Local source differs from the frozen rc.3 snapshot. No patch was applied; use an unmodified extracted source tree.");
  const privateDir = await target(root, "dev/copypaste-delivery/.data/onboarding-162");
  await mkdir(privateDir, {recursive: true});
  const lockPath = path.join(privateDir, "apply.lock");
  const lock = await open(lockPath, "wx");
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, at: new Date().toISOString()}) + "\n");
    const run = await mkdtemp(path.join(privateDir, "apply-"));
    const metadata = path.join(run, "metadata.git");
    // Use owned metadata instead of discovering/modifying a user's parent Git
    // repository. Explicit raw line endings preserve the manifest's bytes.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const flags = ["-c", "core.autocrlf=false", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0"];
    await execute("git", [...flags, "init", "--bare", metadata], {cwd: root, env, windowsHide: true});
    const args = [...flags, "--git-dir=" + metadata, "--work-tree=" + root, "apply", "--whitespace=nowarn"];
    await execute("git", [...args, "--check", "--", patch], {cwd: root, env, windowsHide: true});
    await execute("git", [...args, "--", patch], {cwd: root, env, windowsHide: true});
    for (const {entry, file} of observed) assert.equal(hash(await readFile(file)), entry.after_sha256, "Applied bytes differ from the patch manifest");
    const result = {status: "applied", at: new Date().toISOString(), base_release: manifest.base_release, files: observed.map(v => v.entry.path), patch_sha256: manifest.patch_sha256, applier_sha256: manifest.applier_sha256, scope: "Source onboarding only; local environment, database, runtime binaries and frozen distributions are not patch destinations"};
    await writeFile(path.join(run, "receipt.json"), JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify(result));
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

await main();
