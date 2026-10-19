import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

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
const counts = Object.fromEntries(
  ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [
    key,
    Number(raw.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1] ?? -1),
  ]),
);
const passed =
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
  scope:
    "Current source regression, including real native PostgreSQL, controlled adapters and real Codex with synthetic model dependencies; not all 102 acceptance cases or live role qualification",
};
await writeFile(
  "evidence/alignment-platform.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
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
