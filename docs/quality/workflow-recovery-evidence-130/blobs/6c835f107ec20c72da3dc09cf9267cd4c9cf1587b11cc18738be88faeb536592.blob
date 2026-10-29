import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  pg = createRequire(path.join(platform, "package.json"))("pg"),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
  source = new URL(env.OWNER_DATABASE_URL);
assert.ok(["127.0.0.1", "localhost", "::1"].includes(source.hostname));
const files = [
    "053-credit-repayment-refund-lineage.sql",
    "054-source-bound-refund-facts.sql",
    "055-independent-cash-refund-outcomes.sql",
  ],
  checksums = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        Number(file.slice(0, 3)),
        sha(await readFile(path.join(platform, "migrations", file))),
      ]),
    ),
  ),
  databases = [];
for (const name of ["copypaste", "copypaste_test"]) {
  const url = new URL(source);
  url.pathname = "/" + name;
  const c = new pg.Client({ connectionString: url.href });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const migrations = (
      await c.query(
        "SELECT version,source_sha256 FROM schema_migrations WHERE version>=53 ORDER BY version",
      )
    ).rows;
    assert.equal(migrations.length, 3);
    for (const m of migrations)
      assert.equal(m.source_sha256, checksums[m.version]);
    const tables = (
      await c.query(
        "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",
        [
          [
            "billing_refunds",
            "billing_refund_source_parts",
            "billing_refund_events",
            "billing_refund_closures",
            "billing_credit_opening_balances",
            "billing_credit_legacy_sources",
            "billing_credit_repayment_parts",
            "billing_credit_refund_cancellations",
          ],
        ],
      )
    ).rows;
    assert.equal(tables.length, 8);
    assert.ok(tables.every((t) => t.relrowsecurity));
    await c.query("COMMIT");
    databases.push({
      database: name,
      migrations,
      tables,
      checksums_match: true,
      read_only: true,
    });
  } finally {
    await c.end();
  }
}
const logs = [];
for (const file of [
  "refunds-primary-native-database-start.log",
  "refunds-live-migrations-053-055.log",
]) {
  const bytes = await readFile("evidence/" + file);
  logs.push({ path: "evidence/" + file, sha256: sha(bytes) });
}
const result = {
  at: new Date().toISOString(),
  status: "passed",
  scope:
    "Actual native database migration metadata and RLS table checks, with original startup/migration logs; read-only verification, not complete financial or production acceptance",
  databases,
  logs,
  source_files: Object.fromEntries(
    files.map((file) => [
      "copypaste-platform/migrations/" + file,
      checksums[Number(file.slice(0, 3))],
    ]),
  ),
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  "evidence/refund-migrations.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: result.status,
    databases: databases.length,
    migrations: files.length,
    tables_per_database: 8,
  }),
);
