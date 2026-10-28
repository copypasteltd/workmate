import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-delivery-cloud-121");
const prefix = ".data/dedicated-cloud-121/node-" + attempt, hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", ".tap", "-verifier.mjs"]) await assert.rejects(access(prefix + suffix), e => e.code === "ENOENT");
const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src/cloud-node", "deployment/copypaste-cloud-node.service", "tests/dedicated-cloud-node.test.mjs", "scripts/qualify-dedicated-cloud-node-v1.mjs"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
const sources = {};
for (const file of [...new Set(files)].sort()) { const bytes = await readFile(file); sources[file] = hash(bytes); const target = prefix + "-sources/" + file; await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" }); }
const verifier = await readFile(import.meta.filename); await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const result = spawnSync(process.execPath, ["--test", "tests/dedicated-cloud-node.test.mjs"], { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
const tap = Buffer.from(result.stdout + result.stderr); await writeFile(prefix + ".tap", tap, { flag: "wx" });
const counts = {}; for (const kind of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) counts[kind] = Number(tap.toString().match(new RegExp("^# " + kind + " ([0-9]+)$", "m"))?.[1] ?? -1);
let unchanged = true; for (const [file, expected] of Object.entries(sources)) if (hash(await readFile(file)) !== expected) unchanged = false;
const report = { status: result.status === 0 && counts.tests >= 13 && counts.tests === counts.pass && [counts.fail, counts.cancelled, counts.skipped, counts.todo].every(n => n === 0) && unchanged ? "passed" : "failed", at: new Date().toISOString(), scope: "Adversarial native node broker protocol, durable receipt and revocation tests with an explicit synthetic driver; actual Linux systemd, cgroups, remote host and remote Codex execution are not qualified", counts, source_files: sources, source_unchanged: unchanged, verifier: { path: prefix + "-verifier.mjs", sha256: hash(verifier) }, raw_report: { path: prefix + ".tap", sha256: hash(tap) }, native_service_started: false, docker_wsl_vm_used: false };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, counts, source_unchanged: unchanged })); assert.equal(report.status, "passed");
