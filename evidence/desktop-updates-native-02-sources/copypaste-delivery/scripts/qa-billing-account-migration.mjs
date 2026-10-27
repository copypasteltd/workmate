import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const platform = path.resolve("../copypaste-platform");
const pg = createRequire(path.join(platform, "package.json"))("pg");
process.loadEnvFile(path.join(platform, ".env"));
const phase = process.argv[2];
assert.ok(["before", "after"].includes(phase));
const owner = new URL(process.env.OWNER_DATABASE_URL);
assert.ok(["127.0.0.1", "localhost", "::1"].includes(owner.hostname));
const stateFile = path.resolve(".data/billing-account-migration-before.json");
await mkdir(path.dirname(stateFile), { recursive: true });
const before =
  phase === "after" ? JSON.parse(await readFile(stateFile, "utf8")) : null;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reports = [];
for (const name of ["copypaste", "copypaste_test"]) {
  const url = new URL(owner);
  url.pathname = "/" + name;
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const prior = before?.databases.find((d) => d.database === name);
    const history = {};
    for (const table of ["ledger", "funding_lots", "wallets"]) {
      const columns =
        prior?.history[table].columns ??
        (
          await db.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
            [table],
          )
        ).rows.map((r) => r.column_name);
      assert.ok(columns.every((c) => /^[a-z_]+$/.test(c)));
      const rows = (
        await db.query(
          `SELECT ${columns.map((c) => '"' + c + '"').join(",")} FROM ${table}${table === "wallets" ? " WHERE tenant_id IS NOT NULL" : ""} ORDER BY id`,
        )
      ).rows;
      history[table] = {
        columns,
        rows: rows.length,
        sha256: sha(JSON.stringify(rows)),
      };
      if (prior)
        assert.deepEqual(
          history[table],
          prior.history[table],
          `${name}: original ${table} facts changed`,
        );
    }
    const ledger = (
      await db.query(
        "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
      )
    ).rows;
    const report = {
      database: name,
      history,
      migration: ledger.at(-1).version,
    };
    if (phase === "before")
      assert.equal(
        report.migration,
        41,
        "Capture this upgrade baseline before migration 042 is applied",
      );
    if (phase === "after") {
      const files = (await readdir(path.join(platform, "migrations")))
        .filter((f) => /^\d+.*\.sql$/.test(f))
        .sort();
      const unrecordedPriorVersions = [];
      for (const f of files) {
        const row = ledger.find((r) => r.version === Number(f.split("-")[0]));
        assert.ok(row, `Missing migration ledger row: ${f}`);
        if (row.source_sha256 === null && row.version < 42) {
          unrecordedPriorVersions.push(row.version);
          continue;
        }
        assert.equal(
          row?.source_sha256,
          sha(await readFile(path.join(platform, "migrations", f))),
        );
      }
      assert.equal(ledger.at(-1).version, 44);
      const counts = (
        await db.query(
          "SELECT (SELECT count(*) FROM users)::text AS users,(SELECT count(*) FROM wallets WHERE user_id IS NOT NULL)::text AS personal_accounts,(SELECT count(*) FROM billing_operations)::text AS operations,(SELECT count(*) FROM billing_journal)::text AS journal,(SELECT count(*) FROM billing_provenance_gaps)::text AS gaps",
        )
      ).rows[0];
      assert.equal(BigInt(counts.personal_accounts), 2n * BigInt(counts.users));
      assert.equal(
        (
          await db.query(
            "SELECT 1 FROM wallets WHERE user_id IS NOT NULL AND (balance_micros<>0 OR reserved_micros<>0 OR credit_limit_micros<>0) LIMIT 1",
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT 1 FROM billing_journal j LEFT JOIN billing_operations o ON o.id=j.operation_id LEFT JOIN billing_actors a ON a.id=j.actor_id WHERE o.id IS NULL OR a.id IS NULL OR o.actor_id<>j.actor_id OR o.billing_account_id<>j.billing_account_id LIMIT 1",
          )
        ).rowCount,
        0,
      );
      Object.assign(report, {
        checksums_match: true,
        checksum_scope:
          "All recorded digests and each new 042-044 digest; prior unrecorded digests remain unknown",
        unrecorded_prior_versions: unrecordedPriorVersions,
        original_enterprise_facts_unchanged: true,
        personal_accounts_initially_unfunded: true,
        counts,
      });
    }
    reports.push(report);
    await db.query("COMMIT");
  } finally {
    await db.end();
  }
}
const report = {
  at: new Date().toISOString(),
  phase,
  status: "passed",
  databases: reports,
  scope:
    "Existing local native database migration and recorded financial identities; no external payment or full billing/VIP acceptance",
};
const target =
  phase === "before"
    ? stateFile
    : path.resolve("evidence/billing-accounts-live-migration.json");
await writeFile(target, JSON.stringify(report, null, 2) + "\n");
if (phase === "before")
  await writeFile(
    "evidence/billing-accounts-before-migration.json",
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(
  JSON.stringify({
    phase,
    status: report.status,
    databases: reports.map(({ history, ...rest }) => rest),
  }),
);
