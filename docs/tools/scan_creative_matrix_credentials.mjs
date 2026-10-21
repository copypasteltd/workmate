// Check this stage's retained evidence without printing configuration values.
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../.."),
  evidence = path.join(root, "dev/copypaste-delivery/evidence"),
  id = process.argv[2] ?? "01";
assert.match(id, /^\d{2}$/);
const config = parseEnv(await readFile(path.join(root, "dev/copypaste-platform/.env"), "utf8"));
const needles = new Map();
for (const [name, value] of Object.entries(config)) {
  if (!/(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)$/.test(name) || !value) continue;
  const values = [value];
  if (name.endsWith("DATABASE_URL")) {
    const password = new URL(value).password;
    values.push(password, decodeURIComponent(password));
  }
  for (const candidate of values) if (candidate.length >= 12)
    needles.set(candidate, [...new Set([...(needles.get(candidate) ?? []), name])]);
}
assert.ok(needles.size > 0, "Expected configured credentials for a meaningful scan");
const files = [], matches = [];
async function walk(directory, selected = false) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error("Unexpected evidence symlink");
    const file=path.join(directory,entry.name), include=selected || entry.name.startsWith("creative-matrix-");
    if (entry.isDirectory()) { if (include) await walk(file,true); continue; }
    if (!entry.isFile() || !include) continue;
    const bytes=await readFile(file),text=bytes.toString("utf8");
    files.push({path:path.relative(root,file).replaceAll("\\","/"),sha256:createHash("sha256").update(bytes).digest("hex")});
    const fields=new Set();
    for (const [value,names] of needles) if (text.includes(value)) for (const name of names) fields.add(name);
    if(fields.size) matches.push({path:files.at(-1).path,configuration_fields:[...fields].sort()});
  }
}
await walk(evidence);
assert.ok(files.length > 0);
const report = {
  at: new Date().toISOString(), status: matches.length ? "failed" : "passed",
  scope: "Literal configured credential values and encoded/decoded database passwords of at least 12 characters in this stage's raw reports, source preimages and verifier snapshots; not a whole-product secret audit",
  verifier_sha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"),
  configured_patterns: needles.size, files, matches,
};
await writeFile(path.join(root, `docs/quality/creative-matrix-credential-scan-${id}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, files: files.length, configured_patterns: needles.size, matched_files: matches.length }));
assert.equal(matches.length, 0, "Inspect the report's file and field names privately; never print matched credential values");
