import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") process.exit(0);
const source = path.join(root, "src/local-program-host.cs"), directory = path.join(root, ".data/native-program-host");
const output = path.join(directory, "local-program-host.exe"), manifest = path.join(directory, "manifest.json");
const digest = value => createHash("sha256").update(value).digest("hex");
const sourceHash = digest(await readFile(source));
try {
  const before = JSON.parse(await readFile(manifest, "utf8"));
  if (before.source_sha256 === sourceHash && before.sha256 === digest(await readFile(output))) process.exit(0);
} catch { /* First build or source/binary changed. */ }
await mkdir(directory, { recursive: true });
const compiler = path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
await promisify(execFile)(compiler, ["/nologo", "/target:exe", "/platform:x64", "/optimize+", "/out:" + output, source], { windowsHide: true, timeout: 30000 });
await writeFile(manifest, JSON.stringify({ schema: 1, platform: "windows-x64", source_sha256: sourceHash, sha256: digest(await readFile(output)) }, null, 2) + "\n");
