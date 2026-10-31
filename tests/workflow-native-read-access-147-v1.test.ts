import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, published, company, advance, complete, ok, call, s } from "./workflow-native-handoff-fixture-145-v1.js";
import { saveAsset } from "../src/storage.js";

const definition = { input_schema: { fields: [{ key: "brief", type: "file", required: true }] },
  output_schema: { fields: [{ key: "report", type: "text", step_index: 0, required: true }] },
  steps: [{ kind: "codex", role_key: "fullstack", prompt: "Prepare the reviewed release checklist from the exact approved brief.", budget_micros: 100000 }] };
async function prepared() {
  const f = await fixture(), file = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project,
    user: f.c.id, privateOwner: f.c.id, name: "native-brief.txt", mime: "text/plain", bytes: Buffer.from("Native approved business brief") }), f.tenant, false, f.c.id),
    p = await published(f, definition), requested = await company(f, "workflow_run", { workflow_id: p.workflow_id, version: p.version,
      definition_hash: p.definition_hash, inputs: { brief: file.version.id } });
  return { f, file, p, requested, url: f.root.url + "/workflow-runs/" + requested.run.id };
}

test("Desktop workflow GET rechecks a pending named file's retention without requiring a model invocation", async () => {
  const { f, file, url } = await prepared();
  assert.equal((await ok(s, f.c, "GET", url)).run.input_files[0].asset_version_id, file.version.id);
  await s.db.control.query("UPDATE assets SET retention_expires_at=now()-interval '1 second' WHERE id=$1", [file.id]);
  const result = await call(s, f.c, "GET", url);
  assert.equal(result.status, 409); assert.ok(["TASK_SOURCE_REVOKED", "WORKFLOW_BOUND_INPUT_UNAVAILABLE"].includes(result.data.error.code));
});

test("Desktop keeps completed named output readable after execution finishes, then blocks a withdrawn exact output version", async () => {
  const { f, p, requested, url } = await prepared();
  const approved = await ok(s, f.c, "POST", url + "/decision", { expected_revision: requested.run.revision, stage: "launch", decision: "approve",
    definition_hash: p.definition_hash, input_hash: requested.run.input_hash });
  const step = await advance(f, { ...requested, url, run: approved.run }), childURL = f.base + "/desktop-executions/" + step.child.task_id;
  await ok(s, f.c, "POST", childURL + "/start", step.child.fields);
  await ok(s, f.c, "POST", childURL + "/finish", { ...complete, output: "Complete native named release report, declared as customer-reported fixture output." });
  const done = await advance(f, { ...requested, url, run: step.run }); assert.equal(done.run.state, "succeeded");
  await ok(s, f.c, "POST", f.root.url + "/finish", { ...complete, output: "The local workflow completed in this explicit control-plane fixture." });
  const retained = await ok(s, f.c, "GET", url); assert.equal(retained.run.named_outputs.report, done.run.named_outputs.report);
  const output = retained.run.results.find((r: any) => r.kind === "codex").output_file;
  await s.db.control.query("UPDATE assets SET retention_expires_at=now()-interval '1 second' WHERE id=$1", [output.asset_id]);
  assert.equal((await call(s, f.c, "GET", url)).status, 409);
});
