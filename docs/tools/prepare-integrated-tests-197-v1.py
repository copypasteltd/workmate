from pathlib import Path

root = Path('D:/dev/copypasted/自有agent')
platform = root / 'dev/copypaste-platform'
source = (platform / 'tests/desktop-startup-recovery.test.ts').read_text(encoding='utf8')
header = source[:source.index('test("new protocol')]
tests = r'''
const unknown = { status: "unknown", output: "Unconfirmed local outcome", thread_id: "unknown", turn_id: "unknown" };
const hold = async (id: string) => (await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1", [id])).rows[0];
const zeroProof = async (id: string, kind: string) => (await s.db.control.query("SELECT body FROM task_events WHERE task_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1", [id, kind])).rows[0].body.startup_zero_admission;

test("an unknown pre-turn finish releases only its proven zero-admission reservation, preserves proof and rejects old inference", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  const done = await ok(f.c, "POST", f.url + "/finish", unknown);
  assert.equal(done.status, "cancelled"); assert.equal(done.state, "finished"); assert.equal(done.charged_micros, "0");
  assert.equal((await hold(taskId)).status, "released"); assert.equal((await taskRow(taskId)).output, null);
  const proof = await zeroProof(taskId, "desktop.execution.finished");
  assert.equal(proof.safe, true); assert.equal(proof.turn_admitted, false); assert.equal(proof.model_requests, 0);
  assert.ok([401,403,409].includes((await inference(f.begun.credential.token)).statusCode));
  await ok(f.c, "POST", f.url + "/finish", unknown);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM ledger WHERE task_id=$1 AND kind='charge'", [taskId])).rows[0].n, 0);
});

test("maintenance releases an expired claimed startup only when the durable native turn has not been admitted", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [taskId]);
  await s.desktopExecutions.recover();
  assert.equal((await taskRow(taskId)).status, "cancelled"); assert.equal((await executionRow(taskId)).state, "finished");
  assert.equal((await hold(taskId)).status, "released"); assert.equal((await zeroProof(taskId, "desktop.execution.owner_lost")).safe, true);
});

test("a zero-cost admitted local turn remains uncertain after owner loss", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  await ok(f.c, "POST", f.url + "/turn-admission", f.binding);
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [taskId]);
  await s.desktopExecutions.recover();
  assert.equal((await taskRow(taskId)).status, "reconciling"); assert.equal((await executionRow(taskId)).state, "reconciling");
  assert.equal((await zeroProof(taskId, "desktop.execution.owner_lost")), null);
  assert.equal((await hold(taskId)).status, "reconciling");
});

test("a durable company-tool admission prevents zero-cost startup release", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  await s.db.tx(async tx => {
    await tx.query("SELECT set_config('app.task_id',$1,true)", [taskId]);
    await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'desktop.company_tool.requested',$3)", [f.tenant, taskId, { tool: "asset_read", synthetic_admission_fault: true }]);
  }, f.tenant, false, f.c.id);
  const done = await ok(f.c, "POST", f.url + "/finish", unknown);
  assert.equal(done.status, "reconciling"); assert.equal((await hold(taskId)).status, "reconciling");
  assert.equal(await zeroProof(taskId, "desktop.execution.finished"), null);
});

test("a claimed completion without durable turn admission cannot publish fabricated local output", async () => {
  const f = await fixture(), done = await ok(f.c, "POST", f.url + "/finish", complete);
  assert.equal(done.status, "cancelled"); const task = await taskRow(f.created.task_id);
  assert.equal(task.output, null); assert.equal(task.runtime_turn, null); assert.equal(task.accrued_micros, "0");
});

test("concurrent finish and turn admission serialize so an admitted turn can never use zero-admission settlement", async () => {
  const f = await fixture(), results = await Promise.all([
    call(f.c, "POST", f.url + "/turn-admission", f.binding), call(f.c, "POST", f.url + "/finish", unknown),
  ]);
  assert.equal(results[1].status, 200, JSON.stringify(results[1].data));
  const task = await taskRow(f.created.task_id), proof = await zeroProof(task.id, "desktop.execution.finished");
  if (results[0].status === 200) { assert.equal(task.status, "reconciling"); assert.equal(proof, null); }
  else { assert.equal(results[0].status, 409); assert.equal(task.status, "cancelled"); assert.equal(proof.safe, true); }
});
'''
(platform / 'tests/desktop-unstarted-settlement-197-v1.test.ts').write_text(header + tests, encoding='utf8')
print('Prepared six independent native settlement regressions; no tests run.')
