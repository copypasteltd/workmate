import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2],
  scope = process.argv[3];
assert.ok(["core", "full"].includes(scope));
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(
  path.basename(process.cwd()),
  "copypaste-delivery",
  "Run this verifier from its delivery repository",
);
assert.equal(process.argv.length, 4);
const platform = path.resolve("../copypaste-platform"),
  prefix = "evidence/platform-integration-" + scope + "-" + attempt;
const targeted = new Set([
  "audio-authorization-upgrade",
  "audio-production",
  "brand-production",
  "business-quality",
  "canonical-tasks",
  "capability-video-verification",
  "cloud-development-checks",
  "creative-feedback",
  "desktop-local-runtime",
  "generated-video-jobs",
  "geo-observations",
  "media-effects-render",
  "project-configuration",
  "task-dependencies",
]);
const codexPath = path.resolve(
  "../copypaste-desktop/.data/runtime/windows-x64/codex.exe",
);
assert.equal(
  createHash("sha256")
    .update(await readFile(codexPath))
    .digest("hex"),
  "00c0f1e4099246fddcd67ec620ca8ed50827c7d70e113b7224f7a2933cf2d67c",
);
const testFiles = (await readdir(path.join(platform, "tests")))
  .filter(
    (name) =>
      /^[a-z0-9-]+\.test\.ts$/.test(name) &&
      (scope === "full" || targeted.has(name.slice(0, -8))),
  )
  .sort()
  .map((name) => "tests/" + name);
assert.ok(testFiles.length > 0, "No platform test files were found");
if (scope === "core") assert.equal(testFiles.length, targeted.size, "Every named repair suite must be present");
const hash = (b) => createHash("sha256").update(b).digest("hex");
for (const tail of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + tail), (e) => e.code === "ENOENT");
async function snapshot() {
  const result = {};
  for (const repo of [platform, path.resolve("../copypaste-desktop")]) {
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
        "renderer",
        "renderer-source.json",
        "tests",
        "scripts",
        "migrations",
        "catalog",
        "assets/fonts",
        "public",
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
for (const [file, expected] of Object.entries(before)) {
  const base = path.resolve("..");
  const bytes = await readFile(path.join(base, file));
  assert.equal(hash(bytes), expected);
  const output = path.resolve(prefix + "-sources", file);
  assert.ok(output.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await (
    await import("node:fs/promises")
  ).mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
}
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: platform,
    env: {
      ...process.env,
      COPYPASTE_LOCAL_CODEX_BIN: codexPath,
      COPYPASTE_LOCAL_CODEX_TEST_BIN: codexPath,
      ...env,
    },
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
  for (const args of [
    ["node_modules/typescript/bin/tsc"],
    ["scripts/copy-cloud-check-bootstrap.mjs"],
  ])
    assert.equal(await launch(args).closed, 0);
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
    "Owned native PostgreSQL ready; running every platform test file with real transactions, current permission and billing checks",
  );
  code = await launch([
    "--env-file=.env",
    "scripts/run-tests-owned.mjs",
    ...testFiles,
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
        scope,
        native_codex: {
          path: path
            .relative(path.resolve(".."), codexPath)
            .replaceAll("\\", "/"),
          sha256:
            "00c0f1e4099246fddcd67ec620ca8ed50827c7d70e113b7224f7a2933cf2d67c",
          explicit_bin_and_test_bin: true,
          path_fallback: false,
        },
        test_files: testFiles,
        counts,
        error,
        test_exit: code,
        owned_database_shutdown: shutdown === 0,
        source_unchanged: unchanged,
        source_files: before,
        raw_report: { path: prefix + ".tap", sha256: hash(raw) },
        not_validated: [
          "Actual live provider/customer professional qualification",
          "Actual Web and native Chrome Side Panel UI (qualified separately)",
          "Full product acceptance",
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
