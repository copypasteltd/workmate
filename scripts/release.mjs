import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

const exec = promisify(execFile);
const delivery = path.resolve(import.meta.dirname, "..");
const root = path.resolve(
  process.env.COPYPASTE_DEV_ROOT ?? path.join(delivery, ".."),
);
const output = path.join(delivery, "release");
const names = [
  "copypaste-platform",
  "copypaste-web",
  "copypaste-admin",
  "copypaste-extension",
  "copypaste-desktop",
  "copypaste-delivery",
];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const git = async (repo, ...args) =>
  (
    await exec("git", args, {
      cwd: repo,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const version = (await json(path.join(delivery, "package.json"))).version;
const repositories = [];

// Artifact manifests are intentionally ignored: recording their own commit would
// create a self-reference. Every source checkout must already be clean/committed.
for (const name of names) {
  const repo = path.join(root, name);
  const top = (await git(repo, "rev-parse", "--show-toplevel")).trim();
  if (path.resolve(top).toLowerCase() !== repo.toLowerCase())
    throw new Error(`Not an independent repository: ${name}`);
  if ((await git(repo, "status", "--porcelain")).trim())
    throw new Error(`Commit reviewed source and evidence first: ${name}`);
  const pkg = await json(path.join(repo, "package.json"));
  if (pkg.version !== version) throw new Error(`Version mismatch: ${name}`);
  const files = (await git(repo, "ls-files", "-z"))
    .split("\0")
    .filter(Boolean)
    .sort();
  repositories.push({
    name,
    version,
    branch: (await git(repo, "branch", "--show-current")).trim(),
    commit: (await git(repo, "rev-parse", "HEAD")).trim(),
    tracked_files: files.length,
    source_tree: (await git(repo, "rev-parse", "HEAD^{tree}")).trim(),
    // Committed Git objects give the same index across CRLF/LF checkouts.
    source_tree_index_sha256: sha256(await git(repo, "ls-tree", "-rz", "HEAD")),
  });
}

const evidenceNames = [
  "verification.json",
  "web-admin.json",
  "extension.json",
  "desktop.json",
  "packaged-windows.json",
  "native-controller.json",
  "repository-review.json",
];
const evidence = [];
for (const name of evidenceNames) {
  const file = path.join(delivery, "evidence", name);
  const data = await json(file);
  if (
    data.status === "failed" ||
    data.errors?.length ||
    data.checks?.some(
      (c) =>
        c.status === "failed" ||
        (c.exit_code !== undefined && c.exit_code !== 0),
    )
  )
    throw new Error(`Failed validation: ${name}`);
  if (name === "verification.json" && data.status !== "passed")
    throw new Error("Native verification must pass");
  if (
    ["web-admin.json", "extension.json", "desktop.json"].includes(name) &&
    (!data.checks?.length ||
      data.checks.some((c) => c.status !== "passed") ||
      !data.browser_closed)
  )
    throw new Error(`Incomplete UI evidence: ${name}`);
  if (
    [
      "native-controller.json",
      "repository-review.json",
      "packaged-windows.json",
    ].includes(name) &&
    data.status !== "passed"
  )
    throw new Error(`Incomplete evidence: ${name}`);
  if (
    ["desktop.json", "packaged-windows.json"].includes(name) &&
    !data.electron_closed
  )
    throw new Error(`Application not closed: ${name}`);
  evidence.push({
    file: `evidence/${name}`,
    at: data.at,
    sha256: sha256(await readFile(file)),
  });
}

await mkdir(output, { recursive: true });
const artifacts = [];
async function record(file, kind) {
  artifacts.push({
    kind,
    file: relative(file),
    bytes: (await lstat(file)).size,
    sha256: sha256(await readFile(file)),
  });
}
for (const repo of repositories) {
  const bundle = path.join(output, `${repo.name}-${version}.bundle`);
  await git(path.join(root, repo.name), "bundle", "create", bundle, "--all");
  await git(path.join(root, repo.name), "bundle", "verify", bundle);
  await record(bundle, "git_bundle");
}
for (const name of [
  "copypaste-web",
  "copypaste-admin",
  "copypaste-extension",
]) {
  const from = path.join(root, name, "dist");
  const entries = Object.create(null);
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink())
        throw new Error("Release archives cannot contain symlinks");
      if (item.isDirectory()) await walk(file);
      else if (item.isFile())
        entries[path.relative(from, file).replaceAll("\\", "/")] =
          new Uint8Array(await readFile(file));
    }
  }
  await walk(from);
  if (!Object.keys(entries).length)
    throw new Error(`Build output missing: ${name}`);
  if (name === "copypaste-extension" && !entries["manifest.json"])
    throw new Error("Chrome archive must contain manifest.json at its root");
  const file = path.join(output, `${name}-${version}.zip`);
  await writeFile(file, zipSync(entries, { level: 6 }));
  await record(file, "client_static_build");
}
for (const target of ["Setup", "Portable"]) {
  const filename = `CopyPaste-${version}-x64-${target}.exe`;
  const source = path.join(root, "copypaste-desktop/release", filename);
  const destination = path.join(output, filename);
  await copyFile(source, destination);
  await record(destination, "unsigned_windows_x64");
}
const routes = await json(
  path.join(root, "copypaste-platform/contracts/implemented-routes.json"),
);
const manifest = {
  schema_version: "1.0",
  at: new Date().toISOString(),
  version,
  scope: "Native Windows local pilot; source and reproducible client artifacts",
  production_deployed: false,
  windows_code_signed: false,
  agent_kernel: "codex",
  ai_provider: "company_internal_openai_compatible_only",
  company_live_ai_qualified: false,
  implemented_method_path_pairs: routes.routes.length,
  repositories,
  evidence,
  artifacts,
  pending: [
    "Company AI gateway exact model aliases, credentials and tariffs",
    "Live SMTP, advertising OAuth and S3 qualification",
    "Per-role live business acceptance",
    "SSO, cloud schedules, parallel agents, collaborative editing and full AI video/speech",
    "Production OS account/ACL/network isolation, signing and recovery/SLO verification",
  ],
};
const body = JSON.stringify(manifest, null, 2) + "\n";
await writeFile(path.join(output, "release-manifest.json"), body);
await writeFile(path.join(delivery, "evidence/release-manifest.json"), body);
console.log(
  `Release ${version}: ${repositories.length} clean source repositories, ${artifacts.length} artifacts. Manifest: ${path.join(output, "release-manifest.json")}`,
);
