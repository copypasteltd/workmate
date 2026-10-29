import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import path from "node:path";
assert.equal(process.argv.length, 2); assert.equal(path.basename(process.cwd()), "copypaste-delivery");
const prefix = "evidence/integrated-recovery-full-04", platform = path.resolve("../copypaste-platform"), hash = bytes => createHash("sha256").update(bytes).digest("hex");
await assert.rejects(readFile(prefix + ".json"), e => e.code === "ENOENT");
const raw = await readFile(prefix + ".tap"), text = raw.toString("utf8");
assert.equal(/^# tests \d+\r?$/m.test(text), false, "A completed test report is not an interrupted report");
const directory = ".data/native-qa/4ceb56e5-f3d4-4ef8-8a4c-df69c9ffd4e9", ownerDirectory = ".data/test-fixture-reclamation/8c1fcfae-55c4-4424-81fd-895c7c81ecc3";
const manifest = JSON.parse(await readFile(path.join(platform, ownerDirectory, "manifest.json"), "utf8")), pid = Number((await readFile(path.join(platform, directory, "postmaster.pid"), "utf8")).split(/\r?\n/)[0]);
function gone(pid) { assert.ok(Number.isSafeInteger(pid) && pid > 0); try { process.kill(pid, 0); return false; } catch (error) { if (error.code === "ESRCH") return true; throw error; } }
assert.ok(gone(manifest.owner_pid)); assert.ok(gone(pid));
const portClosed = await new Promise((resolve, reject) => { const socket = connect({ host: "127.0.0.1", port: 1712 }); socket.once("connect", () => { socket.destroy(); resolve(false); }); socket.once("error", error => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(true); else reject(error); }); socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("PORT_STATE_UNKNOWN")); }); }); assert.ok(portClosed);
const sources = {};
async function walk(dir, relative = "") { for (const entry of await readdir(dir, { withFileTypes: true })) { const next = relative ? relative + "/" + entry.name : entry.name; assert.ok(!entry.isSymbolicLink()); if (entry.isDirectory()) await walk(path.join(dir, entry.name), next); else sources[next] = hash(await readFile(path.join(dir, entry.name))); } }
await walk(prefix + "-sources");
const receipt = { at: new Date().toISOString(), status: "interrupted_not_qualified", test_exit: null, counts: null, completed_output_is_partial: true, last_observed_tap_ok: [...text.matchAll(/^ok (\d+) - /gm)].at(-1)?.[1], raw_report: { path: prefix + ".tap", sha256: hash(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: hash(await readFile(prefix + "-verifier.mjs")) }, source_archive: prefix + "-sources", source_files: sources, observed_launcher_gone: true, observed_native_postmaster_gone: true, observed_native_port_closed: true, native_directory: directory, historical_fixture_registration: "Only manifest exists; active fixture ownership was not durably recorded by this older helper", automatic_cleanup: "No historical or ambiguous directory removed", not_validated: ["Actual terminal test exit", "Complete inventory", "Original fixture cleanup", "Original database shutdown exit"], recorder_sha256: hash(await readFile(import.meta.filename)) };
await writeFile(prefix + "-interruption.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: receipt.status, last_observed_tap_ok: receipt.last_observed_tap_ok, archived_sources: Object.keys(sources).length, native_port_closed: portClosed }));
