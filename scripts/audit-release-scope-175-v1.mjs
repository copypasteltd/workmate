/** Inspect the installed catalog and frozen client contracts without invoking providers. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dev = path.join(root, 'dev');
const delivery = path.join(dev, 'copypaste-delivery');
const sha = b => createHash('sha256').update(b).digest('hex');
const read = name => fs.readFile(path.join(root, name), 'utf8');
const evidence = [];
async function inspect(name, patterns) {
  const text = await read(name);
  for (const pattern of patterns) assert.match(text, pattern, name);
  evidence.push({ path: name, sha256: sha(text), inspection: 'source contract; not a new runtime test' });
}

process.chdir(path.join(dev, 'copypaste-platform'));
const { Catalog } = await import(pathToFileURL(path.join(process.cwd(), 'dist/src/catalog.js')).href);
const catalog = new Catalog();
await catalog.load();
assert.ok(catalog.roles.length >= 12);
const roles = [];
for (const role of catalog.roles) {
  const skills = await catalog.boundSkills(role);
  assert.ok(skills.length > 0, role.role_key);
  roles.push({ key: role.role_key, skill_packages: skills.map(s => ({ key: s.key, version: s.version, sha256: s.sha256 })), qualification: 'installed; production/professional validation pending' });
}
await inspect('dev/copypaste-desktop/src/window-controls.ts', [/frame: false/, /autoHideMenuBar: true/]);
await inspect('dev/copypaste-desktop/src/local-codex.ts', [/full-access/, /copypaste_internal/, /COPYPASTE_LOCAL_INFERENCE_TOKEN/, /wire_api = "responses"/]);
await inspect('dev/copypaste-desktop/src/local-agent.ts', [/full-access/, /grant/]);
const manifest = JSON.parse(await read('dev/copypaste-extension/dist/manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
assert.ok(manifest.permissions.includes('sidePanel'));
assert.equal(manifest.action.default_popup, undefined);
const report174 = JSON.parse(await read('docs/quality/admin-team-usage-174.json'));
assert.equal(report174.status, 'qualified');
assert.equal(report174.current_sql_api_cases, 21);
assert.equal(report174.actual_admin_ui_checks, 7);
assert.equal(report174.owned_browser_and_services_closed, true);
const ledger = JSON.parse(await read('docs/quality/remaining-work-stage174.json'));
assert.equal(ledger.requirements.length, 102);
assert.equal(new Set(ledger.requirements.map(r => r.id)).size, 102);
const report = {
  stage: 175, at: new Date().toISOString(), status: 'source_scope_checked', release: 'v0.1.3',
  acceptance_scope: 'Current all-client source and synthetic frozen release; servers/real providers deferred by user on 2026-11-01',
  catalog_load: 'actual Catalog.load and boundSkills digest verification', role_count: roles.length, roles,
  source_inspections: evidence, extension: { manifest_version: 3, native_side_panel: true, toolbar_popup: false },
  current_team_report_checks: { native_sql_api_at174: 21, actual_admin_ui_at174: 7, rerun_at175: false },
  original_requirement_ids: 102, original_full_acceptance_statuses_preserved: true,
  full_professional_or_production_acceptance_claimed: false,
  browser_created: false, services_created: false, virtualization_used: false,
  verifier_sha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
};
const out = path.join(delivery, 'evidence/release-freeze-175/source-scope-01.json');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, role_count: roles.length, native_side_panel: true, report: out }));
