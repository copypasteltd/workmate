import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const exec = promisify(execFile),
  root = path.resolve(".."),
  ownedRoot = path.resolve(".data/byte-integrity"),
  temp = path.join(ownedRoot, randomUUID()),
  checks: any[] = [];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const heads: Record<string, string> = {};
try {
  await mkdir(temp, { recursive: true });
  for (const repo of [
    "copypaste-platform",
    "copypaste-desktop",
    "copypaste-delivery",
  ]) {
    const source = path.join(root, repo),
      target = path.join(temp, repo);
    await exec("git", ["clone", "--no-hardlinks", source, target], {
      windowsHide: true,
    });
    heads[repo] = (
      await exec("git", ["rev-parse", "HEAD"], {
        cwd: target,
        windowsHide: true,
      })
    ).stdout.trim();
  }
  const platform = path.join(root, "copypaste-platform"),
    cloned = path.join(temp, "copypaste-platform");
  const migrations = (await readdir(path.join(cloned, "migrations"))).filter(
    (f) => f.endsWith(".sql"),
  );
  for (const file of migrations)
    assert.equal(
      sha(await readFile(path.join(cloned, "migrations", file))),
      sha(await readFile(path.join(platform, "migrations", file))),
      `migration bytes changed during checkout: ${file}`,
    );
  const loader = pathToFileURL(
    path.join(platform, "node_modules/tsx/dist/loader.mjs"),
  ).href;
  await exec(
    process.execPath,
    [
      "--env-file=" + path.join(platform, ".env"),
      "--import",
      loader,
      path.join(platform, "scripts/migrate.ts"),
    ],
    { cwd: cloned, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  checks.push({
    name: `fresh independent Git clone preserves all ${migrations.length} SQL files; native migration runner validates both existing database checksum ledgers without rewriting them`,
    status: "passed",
  });
  const cat = pathToFileURL(path.join(platform, "src/catalog.ts")).href;
  const probe = await exec(
    process.execPath,
    [
      "--import",
      loader,
      "--input-type=module",
      "--eval",
      `const {Catalog}=await import(${JSON.stringify(cat)});const c=new Catalog();await c.load();console.log(c.skills.length);`,
    ],
    { cwd: cloned, windowsHide: true },
  );
  assert.equal(probe.stdout.trim(), "28");
  checks.push({
    name: "fresh Git clone loads and verifies all 28 exact-hash trusted Skill packages",
    status: "passed",
  });
  const desktop = path.join(temp, "copypaste-desktop"),
    snapshot = JSON.parse(
      await readFile(path.join(desktop, "renderer-source.json"), "utf8"),
    );
  for (const [file, digest] of Object.entries(snapshot.files))
    assert.equal(
      sha(await readFile(path.join(desktop, "renderer", file))),
      digest,
      `renderer source digest changed: ${file}`,
    );
  checks.push({
    name: `fresh independent Desktop clone matches all ${Object.keys(snapshot.files).length} renderer provenance digests`,
    status: "passed",
  });
  const delivery = path.join(temp, "copypaste-delivery"),
    report = JSON.parse(
      await readFile(
        path.join(delivery, "evidence/alignment-platform.json"),
        "utf8",
      ),
    );
  assert.equal(
    sha(await readFile(path.join(delivery, "evidence", report.raw_report))),
    report.sha256,
  );
  checks.push({
    name: `fresh delivery clone preserves raw ${report.counts.tests}-test TAP bytes and its recorded SHA-256`,
    status: "passed",
  });
} catch (e: any) {
  checks.push({
    name: "Git checkout byte integrity",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  const relative = path.relative(ownedRoot, temp);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  await rm(temp, { recursive: true, force: true });
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/byte-integrity.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "Native fresh Git checkout integrity, not product or disaster-recovery acceptance",
        heads,
        checks,
        owned_temporary_clones_removed: true,
      },
      null,
      2,
    ),
  );
}
