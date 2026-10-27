import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = "evidence/paid-input-clients-" + attempt;
const sha = (b) => createHash("sha256").update(b).digest("hex");
await assert.rejects(readFile(prefix + ".json"), (e) => e.code === "ENOENT");
const repos = ["platform", "web", "admin", "desktop", "extension", "delivery"];
async function snapshot() {
  const result = {};
  for (const name of repos) {
    const directory = path.resolve("../copypaste-" + name);
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
        "scripts",
        "tests",
        "public",
        "contracts",
        "catalog",
        "migrations",
        "skills",
        "assets/fonts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "renderer-source.json",
        "vite.config.ts",
        "vite.config.json",
        ".env.example",
        ".gitattributes",
      ],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(
        (f) =>
          /^(src|renderer|scripts|tests|public|contracts|catalog|migrations|skills|assets\/fonts)\//.test(
            f,
          ) ||
          /^(package(-lock)?|tsconfig|renderer-source|vite\.config)\.(json|ts)$/.test(
            f,
          ) ||
          f === ".env.example" ||
          f === ".gitattributes",
      );
    for (const file of [...new Set(files)].sort())
      result[name + "/" + file] = sha(
        await readFile(path.join(directory, file)),
      );
  }
  return result;
}
const before = await snapshot(),
  verifier = await readFile(import.meta.filename),
  checks = [];
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
for (const name of repos) {
  const directory = path.resolve("../copypaste-" + name);
  const jobs = [
    ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
    ...(name === "platform"
      ? [["build", ["node_modules/typescript/bin/tsc"]]]
      : [
          ...(name === "desktop"
            ? [
                [
                  "renderer-typecheck",
                  [
                    "node_modules/typescript/bin/tsc",
                    "--noEmit",
                    "-p",
                    "renderer/tsconfig.json",
                  ],
                ],
              ]
            : []),
          [
            "test",
            [
              "--import",
              "tsx",
              "--test",
              name === "delivery"
                ? "tests/native-surface-integrity.test.mjs"
                : "tests/*.test.ts",
            ],
          ],
        ]),
  ];
  for (const [check, args] of jobs) {
    const file = prefix + "-" + name + "-" + check + ".log",
      log = createWriteStream(file, { flags: "wx" });
    const child = spawn(process.execPath, args, {
      cwd: directory,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const code = await new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    await new Promise((resolve) => log.end(resolve));
    const raw = await readFile(file);
    const counts =
      check === "test"
        ? Object.fromEntries(
            ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(
              (key) => [
                key,
                Number(
                  raw
                    .toString()
                    .match(
                      new RegExp("^# " + key + " (\\d+)\\r?$", "m"),
                    )?.[1] ?? -1,
                ),
              ],
            ),
          )
        : null;
    checks.push({
      repository: name,
      check,
      exit_code: code,
      counts,
      raw_report: file,
      raw_sha256: sha(raw),
    });
    if (code !== 0) break;
  }
  if (checks.at(-1).exit_code !== 0) break;
}
const stable = JSON.stringify(before) === JSON.stringify(await snapshot());
const passed =
  stable &&
  checks.length === 13 &&
  checks.every(
    (c) =>
      c.exit_code === 0 &&
      (!c.counts ||
        (c.counts.tests > 0 &&
          c.counts.tests === c.counts.pass &&
          ["fail", "cancelled", "skipped", "todo"].every(
            (key) => c.counts[key] === 0,
          ))),
  );
await writeFile(
  prefix + ".json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: passed ? "passed" : "failed",
      scope:
        "Current six repositories: typechecking, platform compilation and all existing client/integrity unit suites; no live provider or whole-product qualification",
      source_files: before,
      source_unchanged: stable,
      verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
      checks,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    passed,
    source_unchanged: stable,
    checks: checks.map(({ repository, check, exit_code, counts }) => ({
      repository,
      check,
      exit_code,
      counts,
    })),
  }),
);
assert.ok(passed, "Inspect the preserved client check logs");
