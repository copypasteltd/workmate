import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { analyticsEvidence } from "../src/analytics.js";
import { canonical, hash } from "../src/lib.js";

// Verify the lookup index against saved metrics. Never recompute historical facts.
const db = new Database(loadConfig());
const output = path.resolve(
  process.argv[2] ?? ".data/analysis-index-verification.json",
);
try {
  const result = await db.tx(
    async (tx) => {
      await tx.query("SET TRANSACTION READ ONLY");
      const datasets = (
        await tx.query(
          "SELECT * FROM analytics_datasets WHERE metric_snapshot IS NOT NULL AND content_state<>'deleted' ORDER BY id",
        )
      ).rows;
      const snapshots = [];
      let evidenceCount = 0;
      for (const d of datasets) {
        const expected = analyticsEvidence(d).evidence;
        const actual = (
          await tx.query(
            "SELECT body FROM dataset_evidence WHERE dataset_id=$1 ORDER BY id",
            [d.id],
          )
        ).rows.map((r) => r.body);
        assert.deepEqual(
          actual,
          [...expected].sort((a, b) => a.id.localeCompare(b.id)),
          `Evidence index mismatch: ${d.id}`,
        );
        evidenceCount += actual.length;
        snapshots.push({
          snapshot_id: d.id,
          saved_metric_sha256: hash(canonical(d.metric_snapshot)),
          matched_references: actual.length,
        });
      }
      return {
        snapshot_count: snapshots.length,
        evidence_count: evidenceCount,
        snapshots,
      };
    },
    undefined,
    true,
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "passed",
        scope:
          "Read-only comparison of evidence lookup records against existing frozen metric snapshots; no historical metric recomputation",
        ...result,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${result.snapshot_count} frozen snapshots / ${result.evidence_count} evidence references matched without writes.`,
  );
} finally {
  await db.close();
}
