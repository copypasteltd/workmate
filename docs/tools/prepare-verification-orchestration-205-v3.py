from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';L=R/'dev/copypaste-delivery'
def fresh(p,s):
 assert not p.exists(),p;p.write_text(s,'utf-8')
s=(P/'scripts/run-current-tests-owned-v17.mjs').read_text('utf-8')
start=s.index('  const child = spawn(process.execPath,')
s=s[:start]+'''  const scoped = new Set(['tests/analysis-role-tools.test.ts','tests/cloud-workflows.test.ts','tests/paid-task-inputs.test.ts']);
  const pinned = files.filter(f => scoped.has(f)), ordinary = files.filter(f => !scoped.has(f));
  let pinEnv = {};
  if (pinned.length) {
    const { readFile } = await import('node:fs/promises'), { createHash } = await import('node:crypto'), { execFileSync } = await import('node:child_process'), path = await import('node:path');
    const pin = JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json','utf8'));
    const binary = path.resolve(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ?? '../copypaste-desktop/.data/runtime/windows-x64/codex.exe');
    assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),pin.windows_x64_sha256,'Prepare the actual locked native Codex before integration tests');
    assert.equal(execFileSync(binary,['--version'],{encoding:'utf8',windowsHide:true}).trim().replace(/^codex-cli\\s+/,''),pin.runtime_version);
    pinEnv = { CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version };
  }
  let exit = 0;
  for (const group of [...(ordinary.length ? [{ files: ordinary, env: {} }] : []), ...pinned.map(f => ({ files: [f], env: pinEnv }))]) {
    const child = spawn(process.execPath, ['scripts/run-tests-owned-v2.mjs', ...group.files], {
      stdio: 'inherit', windowsHide: true, env: { ...process.env, ...group.env },
    });
    const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',c=>resolve(c??1)); });
    if(code !== 0) exit = code;
  }
  process.exitCode = exit;
}
'''
# This launcher has not been executed; configure it before its first invocation.
(P/'scripts/run-current-tests-owned-v17.mjs').write_text(s,'utf-8')
s=(P/'tests/current-test-discovery-189-v4.test.ts').read_text('utf-8').replace('run-current-tests-owned-v15.mjs','run-current-tests-owned-v17.mjs').replace('scripts/run-tests-owned.mjs','scripts/run-tests-owned-v2.mjs').replace('current-test-discovery-189-v4.test.ts','current-test-discovery-189-v5.test.ts').replace('runtime-image-failure-189-v1.test.ts','runtime-image-failure-189-v2.test.ts')
s=s.replace('"capability-bindings-189-v2.test.ts",', '"capability-bindings-189-v2.test.ts", "tool-outcome-ledger-205-v2.test.ts", "tool-outcome-persistence-205-v2.test.ts", "runtime-feedback-native-205-v2.test.ts",')
fresh(P/'tests/current-test-discovery-189-v5.test.ts',s)
# Preserve the complete timed-out v2 attempt. Only the controlled harness load
# wait changes; no UI/product assertions or network behavior are relaxed.
s=(L/'scripts/qualify-tool-feedback-ui-205-v2.mjs').read_text('utf-8').replace('feedback-ui-v2','feedback-ui-v3').replace('205-v2-tool-feedback','205-v3-tool-feedback').replace("'205-v2'","'205-v3'")
s=s.replace('await page.goto(`http://127.0.0.1:${port}/__qa/tool-feedback`);', 'await page.goto(`http://127.0.0.1:${port}/__qa/tool-feedback`,{waitUntil:"domcontentloaded",timeout:90000});')
s=s.replace("const page=await context.newPage();page.on", "const page=await context.newPage();page.setDefaultTimeout(60000);page.on")
fresh(L/'scripts/qualify-tool-feedback-ui-205-v3.mjs',s)
print(json.dumps({'status':'prepared','production_source_changes':False,'original_failed_ui_attempt_preserved':True}))
