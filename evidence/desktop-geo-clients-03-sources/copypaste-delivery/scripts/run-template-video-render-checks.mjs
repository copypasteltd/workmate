import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"), id = process.argv[2];
assert.match(id ?? "", /^\d{2}$/);
const prefix = `evidence/template-video-render-${id}`;
await assert.rejects(access(prefix + ".json"), (e) => e.code === "ENOENT");
await assert.rejects(access(prefix + ".tap"), (e) => e.code === "ENOENT");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], { cwd: platform, windowsHide: true, encoding: "utf8", maxBuffer: 8_000_000 });
async function snapshot() {
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter((file) => /^(src|tests|migrations|catalog|contracts|scripts|skills|assets)\//.test(file) || /^(package(-lock)?|tsconfig)\.json$/.test(file) || file === ".env.example" || file === ".gitattributes");
  const result = {};
  for (const file of [...new Set(files)].sort()) result[file] = sha(await readFile(path.join(platform, file)));
  return result;
}
const before = await snapshot(), verifier = await readFile(import.meta.filename);
const changed = new Set([...git(["diff", "--name-only", "HEAD"]).trim().split("\n"), ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")]);
const preimages = [];
for (const file of [...changed].filter((file) => before[file]).sort()) {
  const target = `${prefix}-sources/${file}`;
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, await readFile(path.join(platform, file)), { flag: "wx" });
  preimages.push({ source: file, path: target, sha256: before[file] });
}
await writeFile(prefix + "-sources.json", JSON.stringify({ baseline_commit: git(["rev-parse", "HEAD"]).trim(), files: preimages }, null, 2) + "\n", { flag: "wx" });
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const stream = createWriteStream(prefix + ".tap", { flags: "wx" });
const child = spawn(process.execPath, ["--import", "tsx", "--test", "tests/video-render.test.ts"], { cwd: platform, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (bytes) => stream.write(bytes)); child.stderr.on("data", (bytes) => stream.write(bytes));
const exitCode = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
await new Promise((resolve) => stream.end(resolve));
const bytes = await readFile(prefix + ".tap"), output = bytes.toString(), passed = Number(output.match(/^# pass (\d+)$/m)?.[1] ?? 0), failed = Number(output.match(/^# fail (\d+)$/m)?.[1] ?? 0);
const stable = JSON.stringify(before) === JSON.stringify(await snapshot()) && sha(verifier) === sha(await readFile(import.meta.filename));
const report = { at: new Date().toISOString(), status: exitCode === 0 && passed === 8 && failed === 0 && stable ? "passed" : "failed", scope: "Native FFmpeg video renderer only, including actual 15 second 9:16 media and failure paths; no UI or whole-product acceptance", exit_code: exitCode, passed, failed, source_unchanged: stable, source_files: before, preimages: { path: prefix + "-sources.json", sha256: sha(await readFile(prefix + "-sources.json")) }, verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) }, raw_report: { path: prefix + ".tap", sha256: sha(bytes) } };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, passed, failed, source_unchanged: stable }));
if (report.status !== "passed") process.exitCode = 1;
