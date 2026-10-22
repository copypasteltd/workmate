import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const full = process.argv[3] === "--full";
assert.ok(process.argv.length === 3 || (process.argv.length === 4 && full));
const prefix = `evidence/paid-input-${full ? "regression" : "integration"}-${attempt}`;
for (const suffix of [".json", ".tap", "-database.log"])
  await assert.rejects(access(prefix + suffix), (e) => e.code === "ENOENT");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) =>
  execFileSync(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args],
    {
      cwd: platform,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8_000_000,
    },
  );
async function snapshot() {
  const files = git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(
      (file) =>
        /^(src|tests|migrations|catalog|contracts|scripts|skills|assets)\//.test(
          file,
        ) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(file) ||
        file === ".env.example" ||
        file === ".gitattributes",
    );
  const result = {};
  for (const file of [...new Set(files)].sort())
    result[file] = sha(await readFile(path.join(platform, file)));
  return result;
}
for (const port of [4310, 4317, 4318, 4319, 55432]) {
  const reachable = await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  assert.equal(
    reachable,
    false,
    "Stop the owned stack before isolated SEO verification",
  );
}
const originalFiles = git([
  "ls-tree",
  "-r",
  "--name-only",
  "830ccfb20ed8beb1a5893dc8888ebe53ad6f4ec9",
  "--",
  "migrations",
])
  .trim()
  .split("\n");
assert.equal(originalFiles.length, 79);
for (const file of originalFiles)
  assert.equal(
    sha(await readFile(path.join(platform, file))),
    sha(
      execFileSync(
        "git",
        [
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.untrackedCache=false",
          "show",
          "830ccfb20ed8beb1a5893dc8888ebe53ad6f4ec9:" + file,
        ],
        { cwd: platform, windowsHide: true },
      ),
    ),
    "Previously applied SQL001-079 changed",
  );
const before = await snapshot(),
  verifier = await readFile(import.meta.filename),
  preimages = [];
// SQL078 was successfully applied to the isolated database in integration-01.
// Its original source receipt remains the immutable baseline for later attempts.
const first = JSON.parse(
  await readFile("evidence/scoped-seo-integration-01.json", "utf8"),
);
for (const [file, digest] of Object.entries(first.source_files).filter(
  ([file]) => /^migrations\/078-/.test(file),
)) {
  assert.equal(
    sha(await readFile(path.join(platform, file))),
    digest,
    "Previously applied SQL078 changed",
  );
  assert.equal(
    sha(
      await readFile(
        path.join("evidence/scoped-seo-integration-01-sources", file),
      ),
    ),
    digest,
  );
}
const third = JSON.parse(
  await readFile("evidence/scoped-seo-integration-03.json", "utf8"),
);
for (const [file, digest] of Object.entries(third.source_files).filter(
  ([file]) => /^migrations\/079-/.test(file),
)) {
  assert.equal(
    sha(await readFile(path.join(platform, file))),
    digest,
    "Previously applied SQL079 changed",
  );
  assert.equal(
    sha(
      await readFile(
        path.join("evidence/scoped-seo-integration-03-sources", file),
      ),
    ),
    digest,
  );
}
// SQL080 first committed successfully in integration-02. Its failed assertions
// do not permit rewriting an already applied migration.
const applied80 = JSON.parse(
  await readFile("evidence/seo-change-integration-02.json", "utf8"),
);
for (const [file, digest] of Object.entries(applied80.source_files).filter(
  ([file]) => /^migrations\/080-/.test(file),
)) {
  assert.equal(
    sha(await readFile(path.join(platform, file))),
    digest,
    "Previously applied SQL080 changed",
  );
  assert.equal(
    sha(
      await readFile(
        path.join("evidence/seo-change-integration-02-sources", file),
      ),
    ),
    digest,
  );
}
// SQL081 was first applied successfully by this stage's integration-02.
// Later tests preserve those bytes even if another assertion needs repair.
const applied81 = JSON.parse(
  await readFile("evidence/task-source-integration-02.json", "utf8"),
);
for (const [file, digest] of Object.entries(applied81.source_files).filter(
  ([file]) => /^migrations\/081-/.test(file),
)) {
  assert.equal(
    sha(await readFile(path.join(platform, file))),
    digest,
    "Previously applied SQL081 changed",
  );
  assert.equal(
    sha(
      await readFile(
        path.join("evidence/task-source-integration-02-sources", file),
      ),
    ),
    digest,
  );
}
const first82 = JSON.parse(await readFile("evidence/history-source-integration-04.json", "utf8"));
for (const [file, digest] of Object.entries(first82.source_files).filter(([file]) => /^migrations\/082-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL082 changed");
 assert.equal(sha(await readFile(path.join("evidence/history-source-integration-04-sources",file))),digest);
}
const first83 = JSON.parse(await readFile("evidence/history-source-integration-05.json", "utf8"));
for (const [file, digest] of Object.entries(first83.source_files).filter(([file]) => /^migrations\/083-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL083 changed");
 assert.equal(sha(await readFile(path.join("evidence/history-source-integration-05-sources",file))),digest);
}
const first84 = JSON.parse(await readFile("evidence/history-source-integration-07.json", "utf8"));
for (const [file, digest] of Object.entries(first84.source_files).filter(([file]) => /^migrations\/084-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL084 changed");
 assert.equal(sha(await readFile(path.join("evidence/history-source-integration-07-sources",file))),digest);
}
const first85 = JSON.parse(await readFile("evidence/history-source-integration-09.json", "utf8"));
for (const [file, digest] of Object.entries(first85.source_files).filter(([file]) => /^migrations\/085-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL085 changed");
 assert.equal(sha(await readFile(path.join("evidence/history-source-integration-09-sources",file))),digest);
}
const first86 = JSON.parse(await readFile("evidence/history-source-integration-11.json", "utf8"));
for (const [file, digest] of Object.entries(first86.source_files).filter(([file]) => /^migrations\/086-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL086 changed");
 assert.equal(sha(await readFile(path.join("evidence/history-source-integration-11-sources",file))),digest);
}
const first87 = JSON.parse(await readFile("evidence/history-source-integration-12.json", "utf8"));
for (const [file, digest] of Object.entries(first87.source_files).filter(([file]) => /^migrations\/087-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL087 changed");
 assert.equal(sha(await readFile(path.join("evidence/history-source-integration-12-sources",file))),digest);
}
const first88 = JSON.parse(await readFile("evidence/paid-input-integration-02.json", "utf8"));
for (const [file,digest] of Object.entries(first88.source_files).filter(([file]) => /^migrations\/088-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL088 changed");
 assert.equal(sha(await readFile(path.join("evidence/paid-input-integration-02-sources",file))),digest);
}
const first89 = JSON.parse(await readFile("evidence/paid-input-integration-04.json", "utf8"));
for (const [file,digest] of Object.entries(first89.source_files).filter(([file]) => /^migrations\/089-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL089 changed");
 assert.equal(sha(await readFile(path.join("evidence/paid-input-integration-04-sources",file))),digest);
}
const first90 = JSON.parse(await readFile("evidence/paid-input-integration-05.json", "utf8"));
for (const [file,digest] of Object.entries(first90.source_files).filter(([file]) => /^migrations\/090-/.test(file))) {
 assert.equal(sha(await readFile(path.join(platform,file))),digest,"Previously applied SQL090 changed");
 assert.equal(sha(await readFile(path.join("evidence/paid-input-integration-05-sources",file))),digest);
}
const changed = new Set([
  ...git(["diff", "--name-only", "HEAD"]).trim().split("\n"),
  ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
]);
for (const file of [...changed].filter((file) => before[file]).sort()) {
  const target = `${prefix}-sources/${file}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(path.join(platform, file)), {
    flag: "wx",
  });
  preimages.push({ source: file, path: target, sha256: before[file] });
}
await writeFile(
  prefix + "-sources.json",
  JSON.stringify(
    { baseline_commit: git(["rev-parse", "HEAD"]).trim(), files: preimages },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const dbLog = createWriteStream(prefix + "-database.log", { flags: "wx" });
const database = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
  cwd: platform,
  windowsHide: true,
  env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let ready = "",
  testCode = null,
  stable = false,
  shutdownCode = null;
database.stdout.on("data", (bytes) => {
  ready = (ready + bytes.toString()).slice(-4000);
  dbLog.write(bytes);
});
database.stderr.on("data", (bytes) => dbLog.write(bytes));
const stopped = new Promise((resolve, reject) => {
  database.once("close", resolve);
  database.once("error", reject);
});
const files = full
  ? ["tests/*.test.ts"]
  : ["tests/paid-task-inputs.test.ts", "tests/task-dependencies.test.ts", "tests/task-control.test.ts", "tests/runtime.test.ts"];
try {
  const deadline = Date.now() + 900000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(database.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const log = createWriteStream(prefix + ".tap", { flags: "wx" });
  const suite = spawn(
    process.execPath,
    ["--env-file=.env", "scripts/run-tests-owned.mjs", ...files],
    { cwd: platform, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  suite.stdout.on("data", (bytes) => log.write(bytes));
  suite.stderr.on("data", (bytes) => log.write(bytes));
  testCode = await new Promise((resolve, reject) => {
    suite.once("close", resolve);
    suite.once("error", reject);
  });
  await new Promise((resolve) => log.end(resolve));
  stable =
    JSON.stringify(before) === JSON.stringify(await snapshot()) &&
    sha(verifier) === sha(await readFile(import.meta.filename));
} finally {
  if (database.connected && database.exitCode === null)
    database.send({ action: "shutdown" });
  shutdownCode = await stopped;
  await new Promise((resolve) => dbLog.end(resolve));
  const bytes = await readFile(prefix + ".tap").catch((e) => {
      if (e.code === "ENOENT") return Buffer.alloc(0);
      throw e;
    }),
    output = bytes.toString();
  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [
      key,
      Number(
        output.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1] ?? -1,
      ),
    ]),
  );
  let cleanup = null;
  try {
    const receipt = JSON.parse(
      output.match(/^# owned_fixture_cleanup (.+)$/m)?.[1] ?? "null",
    );
    assert.match(
      receipt.path,
      /^\.data\/test-fixture-reclamation\/[a-f0-9-]{36}\/result\.json$/,
    );
    const raw = await readFile(path.join(platform, receipt.path)),
      result = JSON.parse(raw);
    assert.equal(sha(raw), receipt.sha256);
    assert.equal(receipt.exit_code, 0);
    assert.equal(result.status, "passed");
    assert.equal(result.workers_exited, true);
    assert.equal(result.actual_filesystem_checked, true);
    assert.ok(result.results.every((r) => r.reclaimed));
    await writeFile(prefix + "-fixture-cleanup.json", raw, { flag: "wx" });
    cleanup = { path: prefix + "-fixture-cleanup.json", sha256: sha(raw) };
  } catch {
    /* Failed actual cleanup fails the verification. */
  }
  const passed =
    testCode === 0 &&
    stable &&
    shutdownCode === 0 &&
    cleanup &&
    counts.tests > 0 &&
    counts.tests === counts.pass &&
    ["fail", "cancelled", "skipped", "todo"].every((key) => counts[key] === 0);
  const report = {
    at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    scope:
      "Paid Codex input checkpoints, same-task native continuation, original budget, cumulative actual usage, cancellation, source revocation and immutable tool reuse; user-authorized synthetic AI/business fixtures. No production qualification",
    test_files: files,
    exit_code: testCode,
    counts,
    source_unchanged: stable,
    source_files: before,
    source_preimages: prefix + "-sources.json",
    verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
    raw_report: { path: prefix + ".tap", sha256: sha(bytes) },
    database_log: {
      path: prefix + "-database.log",
      sha256: sha(await readFile(prefix + "-database.log")),
    },
    database_shutdown_exit_code: shutdownCode,
    owned_database_shutdown: shutdownCode === 0,
    fixture_cleanup: cleanup,
  };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      counts,
      source_unchanged: stable,
      owned_database_shutdown: shutdownCode === 0,
    }),
  );
  if (!passed) process.exitCode = 1;
}
