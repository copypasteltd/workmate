import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const prior = JSON.parse(await readFile("renderer-source.json", "utf8")), files = {};
const sha = b => createHash("sha256").update(b).digest("hex");
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Renderer source must be local regular files");
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(file);
    else files[path.relative("renderer", file).replaceAll("\\", "/")] = sha(await readFile(file));
  }
}
await walk("renderer");
await writeFile("renderer-source.json", JSON.stringify({ source: "copypaste-desktop", version: "0.7.1", native_desktop: true,
  upstream: prior.upstream ?? { source: prior.source, version: prior.version, snapshot_sha256: sha(Buffer.from(JSON.stringify(prior))) },
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + "\n");
console.log("Native Desktop renderer hashes recorded; shared Web updates require an explicit merge.");
