"""Create an independent actual-browser journey, retaining earlier verifiers."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'dev/copypaste-delivery/scripts'
old = (SCRIPTS / 'qa-analysis-role-ui.ts').read_text(encoding='utf-8')
start = old[:old.index('  const runTask = async')]
start = start.replace('analysis-role-ui-', 'cloud-workflow-ui-').replace('analysis-', 'cloud-workflow-').replace('"analysis-"', '"cloud-workflow-"')
start = start.replace('"marketing-analyst"', '"workflow-consultant"').replace('const roles = ["workflow-consultant", "information-design"];', 'const roles = ["workflow-consultant"];')
start = start.replace('Harbour marketing analyst', 'Harbour workflow consultant').replace('ANALYSIS-01', 'WORKFLOW-01').replace('ANALYSIS-02', 'WORKFLOW-02')
start = start.replace('localStorage.setItem("cp_locale", "en");', 'if (!localStorage.getItem("cp_locale")) localStorage.setItem("cp_locale", "en");')
start = start.replace('both versioned analysis role templates', 'the versioned workflow role template')
start = start.replace('"cloud-workflow-role-work"', '"cloud-workflow-prepare"')
start = start.replace('Actual specialist creation, customer message, native Codex tools, delivered files and browser download; synthetic model', 'Actual private consultant creation, native Codex tools, fixed workflow request, explicit budget review and private summary download; synthetic model')
body = r'''
  const { advanceCloudWorkflows } = await load("src/cloud-workflows.ts");
  const runTask = async (prompt: string) => {
    currentCalls = [];
    await page.locator('select[name="mode"]').selectOption("execute");
    await page.getByLabel("Your message", { exact: true }).fill(prompt);
    const [sent] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === base + `/conversations/${conversation}/messages` && r.request().method() === "POST"), page.getByRole("button", { name: "Delegate task", exact: true }).click()]);
    assert.equal(sent.status(), 200);
    const accepted = await sent.json();
    await new Worker(system.db, system.catalog, system.storage, new CapturedCodex(system.db.config)).run(tenant, accepted.task.id);
    const task = await call(page, "GET", base + "/tasks/" + accepted.task.id, undefined, tenant);
    assert.equal(task.status, "succeeded", JSON.stringify({ task, tools: currentCalls }));
    const receipts = (await system.db.control.query("SELECT result FROM task_tool_receipts WHERE task_id=$1 AND tool_name='workflow_run'", [task.id])).rows;
    assert.equal(receipts.length, 1);
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
    const execution = { task_id: task.id, native_codex: true, synthetic_model: true, tools: [...currentCalls], charged_micros: task.charged_micros, reservation_count: 1, output: receipts[0].result };
    executions.push(execution); return execution;
  };
  const original = await runTask("Prepare a clearly simulated campaign workflow: calculate the authorized campaign summary, wait for my review, then write a short review note. Save the fixed private version and request my confirmation before any child work.");
  assert.deepEqual(original.tools, ["analysis_sources", "workflow_validate", "workflow_save", "workflow_publish", "workflow_run"]);
  await page.reload(); await page.getByLabel("Your message", { exact: true }).waitFor(); await shot(page, "native-codex-conversation");
  pass("WORKFLOW-03 actual pinned native Codex loads the fixed consultant Skills and prepares one immutable private workflow request; no child task or reservation exists before customer approval");
  let runId = original.output.run.id;
  const listing = async () => call(page, "GET", base + "/cloud-workflows", undefined, tenant);
  const tick = () => advanceCloudWorkflows(system.db, system.catalog, system.storage);
  await page.goto("http://localhost:4317/app/workflows");
  const section = page.getByRole("region", { name: "My private cloud workflows", exact: true });
  const card = (id: string) => page.locator(`[data-workflow-run="${id}"]`);
  await card(runId).waitFor(); await card(runId).scrollIntoViewIfNeeded(); await shot(page, "pending-request");
  await card(runId).getByRole("button", { name: "Review & start", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByText("Budget limit for all Agent steps", { exact: true }).waitFor();
  assert.match(await modal.innerText(), /HK\$0\.10/);
  const confirm = modal.getByRole("button", { name: "Confirm & continue", exact: true });
  await confirm.click(); assert.equal((await listing()).runs[0].authorized, false);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE cloud_workflow_run_id=$1", [runId])).rows[0].n, 0);
  await shot(page, "budget-confirmation");
  await modal.getByRole("checkbox").check(); await confirm.click(); await modal.waitFor({ state: "hidden" });
  await tick(); await tick();
  await section.getByRole("button", { name: "Refresh", exact: true }).click();
  await card(runId).getByRole("button", { name: "Review & continue", exact: true }).waitFor(); await shot(page, "human-review");
  pass("WORKFLOW-04 actual confirmation dialog displays the fixed steps and separate child budget; an unchecked consent cannot start work and the human approval step stops before any Codex child is charged");
  await card(runId).locator("summary").click();
  const [download] = await Promise.all([page.waitForEvent("download"), card(runId).getByRole("button", { name: "Download summary", exact: true }).click()]);
  const file = prefix + "-summary.json"; await download.saveAs(file);
  const summaryBytes = await readFile(file), summary = JSON.parse(summaryBytes.toString());
  assert.equal(summary.snapshot_id, original.output.definition.steps[0].dataset_id);
  assert.equal(summary.currency, (await system.db.control.query("SELECT currency FROM analytics_datasets WHERE id=$1", [summary.snapshot_id])).rows[0].currency); assert.ok(summary.snapshot_id && summary.metrics);
  outputFiles.push({ file: path.relative(delivery, file), bytes: summaryBytes.length, sha256: sha(summaryBytes) });
  const summaryResult = (await listing()).runs[0].results.find((v: any) => v.kind === "analytics.summary");
  assert.equal((await system.db.control.query("SELECT private_owner FROM assets WHERE id=$1", [summaryResult.asset_id])).rows[0].private_owner, signed.user.id);
  pass("WORKFLOW-05 the actual customer clicks Download summary and receives byte-checked calculated JSON, bound to the fixed authorized dataset and private owner");
  media.push(await recording.stop()); recording = undefined;
  recording = new WorkmateRecording("web", "cloud-workflow-review", "cloud-workflow-" + attempt, () => activePage.screenshot({ type: "jpeg", quality: 72 }), "Actual human continuation, native Codex child, exact settlement, private file delivery, immutable procedure revision and responsive review; synthetic model", delivery);
  await recording.start();
  await card(runId).getByRole("button", { name: "Review & continue", exact: true }).click(); modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").check(); await modal.getByRole("button", { name: "Confirm & continue", exact: true }).click(); await modal.waitFor({ state: "hidden" });
  await tick(); let live = (await listing()).runs[0]; assert.ok(live.active_task);
  currentCalls = [];
  await new Worker(system.db, system.catalog, system.storage, new CapturedCodex(system.db.config)).run(tenant, live.active_task);
  const child = await call(page, "GET", base + "/tasks/" + live.active_task, undefined, tenant);
  assert.equal(child.status, "succeeded", JSON.stringify(child));
  assert.deepEqual(currentCalls, ["deliver_text"]);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [child.id])).rows[0].n, 1);
  executions.push({ task_id: child.id, native_codex: true, synthetic_model: true, tools: [...currentCalls], charged_micros: child.charged_micros, reservation_count: 1, output: { actual_child: true } });
  await tick(); live = (await listing()).runs[0]; assert.equal(live.state, "succeeded");
  await section.getByRole("button", { name: "Refresh", exact: true }).click();
  await card(runId).getByText("Specialist work completed", { exact: true }).waitFor(); await shot(page, "completed-delivery");
  const artifact = (await system.db.control.query("SELECT a.id,v.sha256,v.mime_type FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE v.metadata->>'task_id'=$1", [child.id])).rows[0];
  const note = await page.request.get(base + `/assets/${artifact.id}/download`); assert.equal(note.status(), 200);
  const noteBytes = await note.body(); assert.equal(sha(noteBytes), artifact.sha256);
  await writeFile(prefix + "-review-note.md", noteBytes, { flag: "wx" });
  outputFiles.push({ file: path.relative(delivery, prefix + "-review-note.md"), bytes: noteBytes.length, sha256: sha(noteBytes) });
  pass("WORKFLOW-06 actual second approval queues exactly one private cloud child; pinned native Codex creates its real note and the page shows succeeded step receipts and actual single settlement");
  const originalVersion = (await system.db.control.query("SELECT definition,definition_hash FROM workflow_versions WHERE workflow_id=$1 AND version=1", [original.output.run.workflow_id])).rows[0];
  await page.goto("http://localhost:4317/app/conversations/" + conversation); await page.getByLabel("Your message", { exact: true }).waitFor();
  const revised = await runTask(`Revise the approval instructions, preserve the first version and prepare another pending request. workflow_revision_id=${original.output.run.workflow_id}`);
  assert.equal(revised.output.run.version, 2);
  assert.deepEqual((await system.db.control.query("SELECT definition,definition_hash FROM workflow_versions WHERE workflow_id=$1 AND version=1", [original.output.run.workflow_id])).rows[0], originalVersion);
  assert.equal((await system.db.control.query("SELECT state,workflow_version FROM workflow_runs WHERE id=$1", [runId])).rows[0].workflow_version, 1);
  await page.goto("http://localhost:4317/app/workflows"); await card(revised.output.run.id).waitFor(); await card(revised.output.run.id).scrollIntoViewIfNeeded(); await shot(page, "revised-procedure");
  const otherContext = await browser.newContext(), otherPage = await otherContext.newPage();
  const outsider = await signIn(otherPage, "workflow-outsider-" + randomUUID() + "@example.invalid");
  await system.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [tenant, outsider.user.id]);
  await system.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [tenant, project, outsider.user.id]);
  const otherList = await call(otherPage, "GET", base + "/cloud-workflows", undefined, tenant); assert.deepEqual(otherList.items, []); assert.deepEqual(otherList.runs, []);
  assert.equal((await otherPage.request.get(base + `/assets/${summaryResult.asset_id}/download`)).status(), 404);
  await otherContext.close();
  pass("WORKFLOW-07 actual Codex revision creates v2 and a separate pending request while v1 bytes/run remain unchanged; a verified project editor cannot list private workflows or download their private summary");
  // Stop capture before viewport changes to prevent stale screenshot metrics.
  media.push(await recording.stop()); recording = undefined;
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh")); await page.reload();
  for (const width of [375, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(expected => window.innerWidth === expected, width);
    await card(revised.output.run.id).getByRole("button", { name: "核對並開始", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await card(revised.output.run.id).scrollIntoViewIfNeeded();
    const bounds = await card(revised.output.run.id).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    const action = await card(revised.output.run.id).getByRole("button", { name: "核對並開始", exact: true }).boundingBox();
    assert.ok(action && action.x >= 0 && action.x + action.width <= width);
    if (width < 741) {
      assert.equal(await page.locator(".sidebar").getAttribute("aria-hidden"), "true");
      const sidebar = await page.locator(".sidebar").boundingBox();
      assert.ok(sidebar && sidebar.x + sidebar.width <= 1);
    } await shot(page, "review-zh-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await system.db.control.query("UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1", [summary.snapshot_id]);
  assert.equal((await page.request.get(base + `/assets/${summaryResult.asset_id}/download`)).status(), 404);
  assert.equal((await listing()).runs.length, 0);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])", [executions.map(e => e.task_id)])).rows[0].n, 3);
  await page.getByRole("button", { name: "登出", exact: true }).click(); await page.waitForURL("**/login");
  pass("WORKFLOW-08 Traditional Chinese review works at 375/800px without horizontal overflow; source quarantine hides all derived workflow history/downloads while preserving actual billing receipts, and the customer signs out");
'''
tail = old[old.index('} catch (error) {\n  errors.push(String(error));\n  console.error(error);\n} finally {'):]
tail = tail.replace('checks.length === 11', 'checks.length === 8')
target = SCRIPTS / 'qa-cloud-workflow-ui.ts'
assert not target.exists()
target.write_text((start + body + tail).replace('.request.get(base +', '.request.get("http://localhost:4317" + base +'), encoding='utf-8', newline='\n')

runner = (SCRIPTS / 'run-analysis-role-ui.mjs').read_text(encoding='utf-8')
runner = runner.replace('analysis-role-ui-', 'cloud-workflow-ui-').replace('qa-analysis-role-ui.ts', 'qa-cloud-workflow-ui.ts')
runner = runner.replace('Analysis role increment.', 'Private cloud workflow increment.').replace('native Codex analysis, downloads and immutable report revision', 'native Codex workflow preparation, explicit customer approvals, private downloads and immutable procedure revision')
runner = runner.replace('journey.checks.length === 11', 'journey.checks.length === 8').replace('"ANALYSIS-"', '"WORKFLOW-"')
runner = runner.replace('journey.output_files.length === 6', 'journey.output_files.length === 2').replace('journey.executions.length === 2', 'journey.executions.length === 3').replace('e.output.files.length === 9', 'Number(e.charged_micros) > 0')
target = SCRIPTS / 'run-cloud-workflow-ui.mjs'
assert not target.exists()
target.write_text(runner, encoding='utf-8', newline='\n')
print('Created independent workflow UI runner and actual native-Codex browser journey')
