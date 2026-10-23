import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const platform = path.resolve("../copypaste-platform"),
  prefix = "evidence/brand-production-" + attempt;
const hash = (b) => createHash("sha256").update(b).digest("hex");
for (const tail of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + tail), (e) => e.code === "ENOENT");
async function snapshot() {
  const result = {};
  for (const repo of [platform, process.cwd()]) {
    const files = execFileSync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "src",
        "tests",
        "scripts",
        "migrations",
        "catalog",
        "contracts",
        "skills",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
      ],
      { cwd: repo, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(Boolean);
    for (const file of [...new Set(files)].sort())
      result[path.basename(repo) + "/" + file] = hash(
        await readFile(path.join(repo, file)),
      );
  }
  return result;
}
assert.equal(
  await new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port: 55432 });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  }),
  false,
  "Do not adopt an existing database",
);
const before = await snapshot();
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: platform,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const closed = new Promise((resolve) => {
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });
  return { child, closed };
}
let database,
  code = null,
  shutdown = null,
  error;
try {
  assert.equal(
    await launch(["node_modules/typescript/bin/tsc", "--noEmit"]).closed,
    0,
  );
  database = launch(["scripts/native-db-launch.mjs"], {
    COPYPASTE_NATIVE_DATABASE_START_ONLY: "true",
  });
  let output = "";
  database.child.stdout.on(
    "data",
    (b) => (output = (output + b).slice(-16000)),
  );
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) {
    assert.equal(database.child.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(
    "Owned database ready; checking fixed brand versions, actual fonts and production guards",
  );
  code = await launch([
    "--env-file=.env",
    "scripts/run-tests-owned.mjs",
    "tests/brand-production.test.ts",
    "tests/persistent-work.test.ts",
    "tests/agent-templates.test.ts",
    "tests/task-source-visibility.test.ts",
    "tests/migrations.test.ts",
  ]).closed;
} catch (e) {
  error = String(e);
} finally {
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise((r) => log.end(r));
  const raw = await readFile(prefix + ".tap"),
    text = raw.toString();
  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((k) => [
      k,
      Number(
        text.match(new RegExp("^# " + k + " (\\d+)\\r?$", "m"))?.[1] ?? -1,
      ),
    ]),
  );
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()),
    passed =
      !error &&
      code === 0 &&
      shutdown === 0 &&
      unchanged &&
      counts.tests > 0 &&
      counts.pass === counts.tests &&
      ["fail", "cancelled", "skipped", "todo"].every((k) => counts[k] === 0) &&
      text.includes("# owned_fixture_cleanup");
  await writeFile(
    prefix + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        counts,
        error,
        test_exit: code,
        owned_database_shutdown: shutdown === 0,
        source_unchanged: unchanged,
        source_files: before,
        raw_report: { path: prefix + ".tap", sha256: hash(raw) },
        not_validated: [
          "Real customer blind acceptance and ROI",
          "All product acceptance",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: passed ? "passed" : "failed",
      counts,
      error,
      source_unchanged: unchanged,
      shutdown,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
