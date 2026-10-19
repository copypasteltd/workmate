import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const platformRoot = path.resolve("../copypaste-platform");
async function sourceSnapshot() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: platformRoot, encoding: "utf8", windowsHide: true },
  )
    .split("\0")
    .filter(
      (p) =>
        /^(src|tests|migrations|catalog|contracts|scripts|skills)\//.test(p) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(p),
    )
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (p) => [
        p,
        createHash("sha256")
          .update(await readFile(path.join(platformRoot, p)))
          .digest("hex"),
      ]),
    ),
  );
}
const sourceBefore = await sourceSnapshot(),
  verifierBefore = createHash("sha256")
    .update(await readFile(import.meta.filename))
    .digest("hex");

await mkdir("evidence", { recursive: true });
const rawFile = "evidence/alignment-platform.tap";
const output = createWriteStream(rawFile);
const child = spawn(
  process.execPath,
  [
    "--env-file=.env",
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "tests/*.test.ts",
  ],
  {
    cwd: path.resolve("../copypaste-platform"),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", (bytes) => output.write(bytes));
child.stderr.on("data", (bytes) => output.write(bytes));
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
await new Promise((resolve, reject) => {
  output.once("error", reject);
  output.end(resolve);
});
const bytes = await readFile(rawFile);
const raw = bytes.toString("utf8");
const sourceAfter = await sourceSnapshot(),
  verifierAfter = createHash("sha256")
    .update(await readFile(import.meta.filename))
    .digest("hex");
const stable =
  JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter) &&
  verifierBefore === verifierAfter;
const counts = Object.fromEntries(
  ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [
    key,
    Number(raw.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1] ?? -1),
  ]),
);
const passed =
  stable &&
  code === 0 &&
  counts.tests > 0 &&
  counts.pass === counts.tests &&
  ["fail", "cancelled", "skipped", "todo"].every((key) => counts[key] === 0);
const report = {
  at: new Date().toISOString(),
  command: "npm run qa:platform",
  repository: "copypaste-platform",
  status: passed ? "passed" : "failed",
  counts,
  raw_report: path.basename(rawFile),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  source_unchanged: stable,
  source_files: sourceBefore,
  verifier_sha256: verifierBefore,
  scope:
    "Current source regression, including real native PostgreSQL, controlled adapters and real Codex with synthetic model dependencies; not all 102 acceptance cases or live role qualification",
};
await writeFile(
  "evidence/alignment-platform.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: report.status,
    counts,
    sha256: report.sha256,
    source_unchanged: stable,
    source_files: Object.keys(sourceBefore).length,
  }),
);
if (!passed) {
  console.error(
    raw
      .split("\n")
      .filter((line) => line.startsWith("not ok") || line.includes("error:"))
      .slice(0, 12)
      .join("\n"),
  );
  process.exitCode = 1;
}
