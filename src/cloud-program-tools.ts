import { unzipSync, zipSync } from "fflate";
import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { saveAsset } from "./storage.js";
import { CodeWorkspace } from "./code-workspace.js";
import { exportCloudSources } from "./cloud-source.js";
import {
  sourceManifest,
  sourceDigest,
  runCloudProgram,
  type ProgramSource,
  cloudProgramInput,
  type CloudCheckDriver,
} from "./cloud-program-executor.js";
import type { z } from "zod";
import { hash, Problem } from "./lib.js";
import {
  runCloudBrowserPreview,
  type BrowserPreviewInput,
} from "./cloud-browser-preview.js";
export const cloudCheckTools = [
  "process_run_allowed",
  "api_test",
  "database_test_native",
  "browser_preview",
];

export async function taskProgramSources(
  tx: Tx,
  storage: Storage,
  t: any,
  workspace: CodeWorkspace,
) {
  let sources: ProgramSource[];
  if (t.conversation_id && t.private_owner) {
    const bundle = await exportCloudSources(tx, storage, t);
    sources = Object.entries(bundle.data).map(([path, bytes]) => ({
      path,
      bytes: Buffer.from(bytes),
    }));
  } else {
    sources = [];
    for (const f of await workspace.list()) {
      const current = await workspace.read(f.path),
        bytes = Buffer.from(current.content);
      if (hash(bytes) !== f.sha256)
        throw new Problem(
          409,
          "CODE_VERSION_CONFLICT",
          "A source changed before execution",
        );
      sources.push({ path: f.path, bytes });
    }
  }
  return { sources, manifest: sourceManifest(sources) };
}

export async function executeTaskProgram(
  tx: Tx,
  storage: Storage,
  t: any,
  user: string,
  dataDir: string,
  workspace: CodeWorkspace,
  input: z.input<typeof cloudProgramInput>,
  authorize: () => Promise<void>,
  signal?: AbortSignal,
  driver?: CloudCheckDriver,
) {
  const { sources } = await taskProgramSources(tx, storage, t, workspace);
  const { receipt, files } = await runCloudProgram(
    dataDir,
    input,
    sources,
    signal,
    driver,
  );
  return saveTaskCheck(tx, storage, t, user, workspace, authorize, {
    receipt,
    files,
  });
}

export async function executeTaskBrowser(
  tx: Tx,
  storage: Storage,
  t: any,
  user: string,
  dataDir: string,
  workspace: CodeWorkspace,
  input: BrowserPreviewInput,
  authorize: () => Promise<void>,
  signal?: AbortSignal,
) {
  const { sources } = await taskProgramSources(tx, storage, t, workspace);
  const result = await runCloudBrowserPreview(dataDir, input, sources, signal);
  return saveTaskCheck(tx, storage, t, user, workspace, authorize, result);
}

async function saveTaskCheck(
  tx: Tx,
  storage: Storage,
  t: any,
  user: string,
  workspace: CodeWorkspace,
  authorize: () => Promise<void>,
  {
    receipt,
    files,
  }:
    | Awaited<ReturnType<typeof runCloudProgram>>
    | Awaited<ReturnType<typeof runCloudBrowserPreview>>,
) {
  await authorize();
  const current = await taskProgramSources(tx, storage, t, workspace);
  if (sourceDigest(current.manifest) !== receipt.source_digest)
    throw new Problem(
      409,
      "CODE_VERSION_CONFLICT",
      "Sources changed while this command was running",
    );
  const record = await saveAsset(tx, storage, {
    tenant: t.tenant_id,
    project: t.project_id,
    user,
    name: `${receipt.program}-${receipt.execution_id}.json`,
    mime: "application/json",
    bytes: Buffer.from(JSON.stringify(receipt, null, 2) + "\n"),
    kind: "software_execution_receipt",
    metadata: {
      task_id: t.id,
      source_digest: receipt.source_digest,
      program: receipt.program,
      passed: receipt.passed,
      exit_code: receipt.exit_code,
    },
  });
  const data: Record<string, Uint8Array> = {
    "execution-receipt.json": Buffer.from(
      JSON.stringify(receipt, null, 2) + "\n",
    ),
  };
  for (const f of files) data["files/" + f.path] = f.bytes;
  const artifacts = await saveAsset(tx, storage, {
    tenant: t.tenant_id,
    project: t.project_id,
    user,
    name: `program-output-${receipt.execution_id}.zip`,
    mime: "application/zip",
    bytes: Buffer.from(zipSync(data, { level: 6 })),
    kind: "software_execution_output",
    metadata: {
      task_id: t.id,
      source_digest: receipt.source_digest,
      receipt_asset_id: record.id,
      execution_validation: receipt.passed
        ? "command_passed"
        : "command_failed",
      files: receipt.output_manifest,
    },
  });
  const picture =
    receipt.program === "browser_preview"
      ? files.find((f) => f.path === "browser-preview.png")
      : null;
  const preview = picture
    ? await saveAsset(tx, storage, {
        tenant: t.tenant_id,
        project: t.project_id,
        user,
        name: `browser-preview-${receipt.execution_id}.png`,
        mime: "image/png",
        bytes: picture.bytes,
        kind: "software_browser_preview",
        metadata: {
          task_id: t.id,
          source_digest: receipt.source_digest,
          receipt_asset_id: record.id,
        },
      })
    : null;
  return { receipt, record, artifacts, ...(preview ? { preview } : {}) };
}

/** Bind checks to the exact current file manifest, not a task-level green flag.
 * A failed invocation remains failed even when another command succeeded. */
export async function checkedSourcePackage(
  tx: Tx,
  t: any,
  zip: {
    bytes: Buffer;
    files: { path: string; bytes: number; sha256: string }[];
  },
) {
  const digest = sourceDigest(zip.files);
  const rows = (
    await tx.query(
      "SELECT result FROM task_tool_receipts WHERE task_id=$1 AND tool_name=ANY($3::text[]) AND result->'receipt'->>'source_digest'=$2 ORDER BY created_at",
      [t.id, digest, cloudCheckTools],
    )
  ).rows;
  const checks = rows
    .map((r) => r.result)
    .filter((r) => r?.receipt?.source_digest === digest);
  if (!checks.length)
    return { ...zip, execution_validation: "not_executed", checks: [] };
  for (const check of checks) {
    const ids = [
      check.record.version.id,
      check.artifacts.version.id,
      ...(check.preview ? [check.preview.version.id] : []),
    ];
    const available = (
      await tx.query(
        "SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=ANY($1::uuid[]) AND a.state='active' AND v.erased_at IS NULL AND a.retention_expires_at>clock_timestamp() AND task_asset_version_sources_available(v.id)",
        [ids],
      )
    ).rowCount;
    if (available !== ids.length)
      throw new Problem(
        409,
        "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
        "A recorded check or its files are no longer available",
      );
  }
  const data = unzipSync(zip.bytes);
  for (const c of checks)
    data[`copypaste-checks/${c.receipt.execution_id}.json`] = Buffer.from(
      JSON.stringify(c.receipt, null, 2) + "\n",
    );
  const summary = checks.map((c) => ({
    execution_id: c.receipt.execution_id,
    program: c.receipt.program,
    entry: c.receipt.entry,
    exit_code: c.receipt.exit_code,
    passed: c.receipt.passed,
    receipt_asset_id: c.record.id,
  }));
  data["copypaste-manifest.json"] = Buffer.from(
    JSON.stringify(
      {
        files: zip.files,
        source_digest: digest,
        execution_validation: "checks_recorded",
        checks: summary,
        note: "Only the listed commands were executed against these exact source bytes. This is not a claim of complete functional, security or deployment coverage.",
      },
      null,
      2,
    ) + "\n",
  );
  return {
    ...zip,
    bytes: Buffer.from(zipSync(data, { level: 6 })),
    execution_validation: "checks_recorded",
    checks: summary,
  };
}
