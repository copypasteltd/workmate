import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

assert.equal(path.basename(process.cwd()), "copypaste-delivery-cloud-121");
const source = path.resolve("../copypaste-extension"), target = path.resolve("../copypaste-extension-cloud-121");
const output = ".data/dedicated-cloud-121/extension-preparation-01.json";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], { cwd, encoding: "utf8", windowsHide: true });
assert.equal(git(target, "branch", "--show-current").trim(), "codex/dedicated-cloud-121");
assert.equal(git(target, "rev-parse", "HEAD").trim(), git(source, "rev-parse", "HEAD").trim());
await assert.rejects(lstat(output), error => error.code === "ENOENT");
const files = [...new Set(git(source, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "public", "scripts", "tests", "package.json", "package-lock.json").split("\0").filter(Boolean))].sort();
const changes = [], sources = {};
for (const name of files) {
  assert.ok(!path.isAbsolute(name) && !name.split("/").includes(".."));
  const original = path.join(source, name), destination = path.join(target, name);
  assert.ok((await lstat(original)).isFile());
  const bytes = await readFile(original), before = await readFile(destination).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  sources[name] = hash(bytes);
  if (before && hash(before) === hash(bytes)) continue;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  assert.equal(hash(await readFile(destination)), sources[name]);
  changes.push({ path: name, before_sha256: before ? hash(before) : null, after_sha256: sources[name] });
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ status: "prepared", at: new Date().toISOString(), source: path.basename(source), target: path.basename(target), base_commit: git(target, "rev-parse", "HEAD").trim(), source_files: sources, changes, verifier_sha256: hash(await readFile(import.meta.filename)) }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "prepared", source_files: files.length, changed_files: changes.length }));
