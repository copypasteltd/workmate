import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LocalCodexSession } from '../../copypaste-desktop/src/local-codex.ts';
import { Catalog } from '../src/catalog.ts';
import { TaskBusinessTools } from '../src/task-business-tools.ts';
import { desktopCompanyToolSchema, desktopToolDeclarations } from '../src/desktop-tool-policy.ts';
import { canonical } from '../src/lib.ts';
import { listenLoopbackHTTP } from '../src/loopback-http.ts';

const root = path.resolve('../copypaste-delivery/.data/acceptance-189/native-media-' + randomUUID());
const workspace = path.join(root, 'workspace'); await mkdir(workspace, { recursive: true });
const originalPath = 'contracts/native-video-tool-wire-0.163.0-alpha.11.json';
const originalBytes = await readFile(originalPath), previous = JSON.parse(originalBytes.toString());
const pin = JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json', 'utf8'));
const catalog = new Catalog(); await catalog.load();
const role = [...catalog.roles, ...catalog.historicalRoles].find(r => r.role_key === previous.role_key && r.version === previous.role_version);
assert.ok(role);
const names = new Set(previous.tools.map(t => t.name));
const tools = new TaskBusinessTools({ config: { DATA_DIR: root } }, catalog, {},
  { authorize: async () => {}, inference: async () => {}, videoReady: true }).build({
  id: randomUUID(), tenant_id: randomUUID(), project_id: randomUUID(),
  execution_location: 'desktop', input_context: {}, mode: 'execute',
}, {}, '', role).filter(t => names.has(t.name));
assert.equal(tools.length, names.size);
const company = tools.map(({ name, description, inputSchema }) =>
  ({ name, description, inputSchema: desktopCompanyToolSchema(inputSchema) }));
let request;
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(request, undefined, 'Capture must use one unbilled protocol response');
    request = JSON.parse(Buffer.concat(chunks).toString());
    await writeFile(path.join(root, 'actual-wire.private.json'), JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
    const item = { id: 'msg_capture', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'ACTUAL_NATIVE_SCHEMA_CAPTURE', annotations: [] }] };
    const response = { id: 'resp_capture', object: 'response', model: 'copypaste-contract-probe',
      status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [type, data] of [['response.created', { response: { ...response, status: 'in_progress', output: [] } }],
      ['response.output_item.added', { output_index: 0, item }], ['response.output_item.done', { output_index: 0, item }],
      ['response.completed', { response }]]) res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
    res.end();
  } catch { res.destroy(); }
});
const port = await listenLoopbackHTTP(server), origin = 'http://127.0.0.1:' + port, actor = randomUUID();
const session = new LocalCodexSession({
  executable: path.resolve('../copypaste-desktop/.data/runtime/windows-x64/codex.exe'),
  version: pin.runtime_version, executableSha256: pin.windows_x64_sha256,
  companyOrigin: origin, baseURL: origin + '/v1', model: 'copypaste-contract-probe', effort: 'max',
}, { sessionId: randomUUID(), actorId: actor, tenantId: randomUUID(), projectId: randomUUID(),
  workspace, stateRoot: root, grant: { id: randomUUID(), actorId: actor, mode: 'full-access', revision: 1, expiresAt: Date.now() + 180000 },
  skills: [], companyTools: company,
}, { authorize: async () => {}, event: async () => {}, companyTool: async () => { throw new Error('No effects authorized'); } });
const report = { stage: 189, status: 'running', scope: 'Actual pinned native wire capture against a labelled synthetic upstream; no supplier call or tool effects.' };
try {
  await session.start({ token: randomUUID(), expiresAt: Date.now() + 180000 });
  const result = await session.turn('Return only ACTUAL_NATIVE_SCHEMA_CAPTURE. This is a protocol fixture; do not execute tools.');
  assert.equal(result.status, 'completed');
  const namespaces = [...(request.tools ?? []), ...(request.input ?? []).filter(x => x.type === 'additional_tools').flatMap(x => x.tools)];
  const namespace = namespaces.find(t => t.type === 'namespace' && t.name === 'copypaste');
  assert.ok(namespace, 'Native company declarations absent');
  assert.equal(desktopToolDeclarations([namespace], company), true);
  const captured = previous.tools.map(old => {
    const actual = namespace.tools.find(t => t.name === old.name);
    assert.ok(actual); assert.equal(canonical(actual.parameters), canonical(company.find(t => t.name === old.name).inputSchema));
    const { type, ...wire } = actual; assert.equal(type, 'function'); return wire;
  });
  const target = 'contracts/native-video-tool-wire-0.163.0-alpha.11-189-v1.json';
  await writeFile(target, JSON.stringify({ ...previous, tools: captured,
    source: 'Actual stage189 fixed native process request with server-issued trusted schemas.',
    previous_fixture_sha256: createHash('sha256').update(originalBytes).digest('hex') }, null, 2) + '\n', { flag: 'wx' });
  const oldTest = await readFile('tests/desktop-browser-policy.test.ts', 'utf8');
  assert.ok(oldTest.includes(originalPath));
  await writeFile('tests/desktop-browser-policy-189-v1.test.ts', oldTest.replace(originalPath, target), { flag: 'wx' });
  report.status = 'passed'; report.tools = captured.map(t => t.name); report.contract = target;
  report.contract_sha256 = createHash('sha256').update(await readFile(target)).digest('hex');
} catch (error) { report.status = 'failed'; report.error = error.message; }
finally {
  await session.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.owned_processes_closed = true;
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ root, ...report }));
}
assert.equal(report.status, 'passed');
