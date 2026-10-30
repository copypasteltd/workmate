// User-authorized publication. Explicit refs, no force, no remote deletion.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

const exec = promisify(execFile);
const delivery = path.resolve(import.meta.dirname, "..");
const root = path.resolve(delivery, "../..");
const remote = "git@github.com:copypasteltd/workmate.git";
const mode = process.argv[2];
assert.ok(mode === "--check" || mode === "--push", "Use --check or the explicitly authorized --push");
assert.equal(process.argv.length, 3);
const mapping = [
  ["backend", "platform"], ["web", "web"], ["admin", "admin"],
  ["desktop", "desktop"], ["extension", "extension"], ["delivery", "delivery"],
];
const receiptDirectory = path.join(delivery, ".data/publication", randomUUID());
await mkdir(receiptDirectory, { recursive: true });
const receipt = {
  started_at: new Date().toISOString(), mode, remote, status: "started",
  branches: [], checks: [], remote_before: {}, remote_after: {}, failure: null,
};
async function run(file, args, cwd = root) {
  return exec(file, args, {
    cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
  });
}
async function git(cwd, ...args) {
  return (await run("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], cwd)).stdout.trim();
}
async function refs() {
  const raw = await git(root, "ls-remote", "--heads", "origin");
  return Object.fromEntries(raw.split(/\r?\n/).filter(Boolean).map(line => {
    const [sha, ref] = line.split(/\s+/);
    assert.match(sha, /^[a-f0-9]{40}$/);
    return [ref.replace(/^refs\/heads\//, ""), sha];
  }));
}
async function independent(directory, branch) {
  const top = await git(directory, "rev-parse", "--show-toplevel");
  assert.equal(path.resolve(top).toLowerCase(), directory.toLowerCase(), "Expected independent repository " + branch);
  assert.equal(await git(directory, "remote", "get-url", "origin"), remote);
  const localBranch = await git(directory, "branch", "--show-current");
  assert.ok([branch, "codex/" + branch].includes(localBranch), "Use the mapped published branch or its codex/ working branch: " + branch);
  assert.equal(await git(directory, "status", "--porcelain"), "", "Commit reviewed changes before publication: " + branch);
  const commit = await git(directory, "rev-parse", "HEAD");
  assert.match(commit, /^[a-f0-9]{40}$/);
  return { branch, local_branch: localBranch, directory, commit, tree: await git(directory, "rev-parse", "HEAD^{tree}") };
}
try {
  for (const [branch, component] of mapping) {
    receipt.branches.push(await independent(path.join(root, "dev/copypaste-" + component), branch));
  }
  const docs = await independent(root, "docs");
  receipt.branches.push(docs, { ...docs, branch: "main" });
  receipt.branches.sort((a, b) => {
    const rank = (branch) => branch === "main" ? 0 : branch === "docs" ? 1 : 2;
    return rank(a.branch) - rank(b.branch);
  });
  const manifestPath = path.join(root, "docs/quality/workmate-publication.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.status, "ready_for_remote_verification_sharded");
  assert.equal(manifest.proofs_format, "workmate.proofs.sharded.v1");
  assert.deepEqual(manifest.proofs, []);
  assert.ok(manifest.proof_count > 0 && manifest.proof_shards.length > 0);
  assert.equal(manifest.remote, remote);
  for (const item of receipt.branches.filter(r => !["docs", "main"].includes(r.branch)))
    assert.equal(manifest.components.find(c => c.branch === item.branch)?.commit, item.commit, "Component manifest must bind final commits");
  receipt.manifest_sha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const checks = await run("python", [
    "docs/tools/audit_workmate_publication_v5.py", "--report", "workmate-publication-audit-01.json",
    "--media", manifest.media_attempt, "--verify-only",
  ]);
  const checked = JSON.parse(checks.stdout.trim());
  assert.equal(checked.status, "passed");
  assert.equal(checked.committed_proofs, manifest.proof_count);
  assert.equal(checked.proof_shards, manifest.proof_shards.length);
  receipt.proof_shards = manifest.proof_shards;
  receipt.checks.push(checked);
  // Import only reviewed component commit objects. This does not checkout or
  // alter their independent working directories or local history.
  for (const item of receipt.branches.filter(r => !["docs", "main"].includes(r.branch))) {
    const staging = "refs/workmate-staging/" + item.branch + "-" + item.commit;
    await git(root, "fetch", "--no-tags", "--no-write-fetch-head", item.directory, "HEAD:" + staging);
    assert.equal(await git(root, "rev-parse", staging), item.commit);
  }
  receipt.remote_before = await refs();
  for (const item of receipt.branches) {
    const old = receipt.remote_before[item.branch];
    if (!old || old === item.commit) continue;
    const checkpoint = "refs/workmate-remote/" + item.branch + "-" + old;
    await git(root, "fetch", "--no-tags", "--no-write-fetch-head", "origin", "refs/heads/" + item.branch + ":" + checkpoint);
    assert.equal(await git(root, "rev-parse", checkpoint), old);
    await git(root, "merge-base", "--is-ancestor", old, item.commit);
  }
  for (const item of receipt.branches) {
    assert.equal(await git(item.directory, "rev-parse", "HEAD"), item.commit, "Sources changed during preflight");
    assert.equal(await git(item.directory, "status", "--porcelain"), "");
  }
  receipt.checks.push({ status: "passed", check: "clean independent repositories, committed component manifest, configured secrets/history/media/link audit and non-destructive remote ancestry" });
  if (mode === "--push") {
    const pushed = await git(root, "push", "--atomic", "--porcelain", "origin",
      ...receipt.branches.map(item => item.commit + ":refs/heads/" + item.branch));
    receipt.push_porcelain = pushed;
    receipt.remote_after = await refs();
    for (const item of receipt.branches)
      assert.equal(receipt.remote_after[item.branch], item.commit, "Remote SHA mismatch: " + item.branch);
    assert.equal(receipt.remote_after.docs, receipt.remote_after.main);
    receipt.status = "pushed_and_verified";
  } else {
    receipt.status = "preflight_passed";
  }
} catch (error) {
  receipt.status = "failed";
  // Child stdout/stderr can contain sensitive local data. Keep only an error
  // class/message here, and never print command output on a failed secret scan.
  receipt.failure = error instanceof assert.AssertionError ? error.message : "Publication command failed; inspect the local operation without exposing credentials";
} finally {
  receipt.finished_at = new Date().toISOString();
  await writeFile(path.join(receiptDirectory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({
    status: receipt.status, remote, branches: receipt.branches.map(({ branch, commit }) => ({ branch, commit })),
    receipt: path.relative(root, path.join(receiptDirectory, "receipt.json")).replaceAll("\\", "/"),
    failure: receipt.failure,
  }));
}
assert.ok(["preflight_passed", "pushed_and_verified"].includes(receipt.status), "Publication did not complete; retain the receipt and correct the cause without force-pushing");
