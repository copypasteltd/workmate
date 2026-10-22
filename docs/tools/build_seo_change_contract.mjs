import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFile(path.join(root, p));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const oldBytes = await read('docs/contracts/scoped-seo-openapi.json');
const old = JSON.parse(oldBytes);
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = { type: 'string' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const ref = (name) => ({ $ref: '#/components/schemas/' + name });
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
const amount = object({ currency: { const: 'HKD', type: 'string' }, amount_micros: { type: 'string', pattern: '^\\d+$' } });
const ids = { type: 'array', items: uuid, minItems: 1, maxItems: 20, uniqueItems: true };
const statuses = ['queued','needs_input','paused','awaiting_approval','running','succeeded','failed','cancelled','reconciling'];
const dataMode = { type: 'string', enum: ['simulated', 'configured_services'] };
const narrative = {
  finding_id: uuid,
  rationale: { type: 'string', minLength: 1, maxLength: 2000 },
  proposed_change: { type: 'string', minLength: 1, maxLength: 8000 },
  verification: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 2000 } },
};
const fields = {
  id: uuid, audit_id: uuid, project_id: uuid, task_id: uuid,
  title: { type: 'string', minLength: 1, maxLength: 160 },
  objective: { type: 'string', minLength: 5, maxLength: 8000 },
  finding_ids: ids,
  state: { type: 'string', enum: [...statuses, 'draft_ready'] },
  task_status: { type: 'string', enum: statuses }, task_version: integer,
  error_code: nullable(text), created_at: { type: 'string', format: 'date-time' }, data_mode: dataMode,
  spec_hash: hash, source_spec_hash: hash, source_result_version_id: uuid, source_result_sha256: hash,
  json_asset_version_id: nullable(uuid), html_asset_version_id: nullable(uuid),
  budget: amount, confirmed_cost: amount, website_modified: { type: 'boolean', const: false },
};
const schemas = {
  SeoChangeCreateInput: object({
    agent_id: uuid, source_result_version_id: uuid,
    title: fields.title, objective: fields.objective, finding_ids: ids,
    budget: object({ currency: { type: 'string', const: 'HKD' }, amount_micros: {
      type: 'string', pattern: '^(?:[1-9]\\d{0,11}|1000000000000)$',
      description: 'Exact positive HKD micros; server also enforces <= 1000000000000.',
    } }),
  }),
  SeoChange: object(fields),
  SeoChangeDetail: object({ ...fields, draft: nullable(ref('SeoChangeDraft')) }),
  SeoChangeList: object({ audit_id: uuid, items: { type: 'array', maxItems: 25, items: ref('SeoChange') }, total: integer, next_offset: nullable(integer) }),
  SeoChangeDraft: object({
    schema_version: { type: 'integer', const: 1 }, change_id: uuid, task_id: uuid, audit_id: uuid,
    spec_hash: hash, source_spec_hash: hash, source_result_version_id: uuid, source_result_sha256: hash,
    created_at: { type: 'string', format: 'date-time' }, data_mode: dataMode,
    state: { type: 'string', const: 'draft' }, website_modified: { type: 'boolean', const: false },
    title: fields.title, objective: fields.objective, coverage: ref('SeoCoverage'),
    changes: { type: 'array', minItems: 1, maxItems: 20, items: object({ ...narrative, evidence: ref('SeoFinding') }) },
    limitations: { type: 'array', minItems: 1, items: text },
  }),
  SeoFinding: old.components.schemas.SeoFinding,
  SeoCoverage: old.components.schemas.SeoCoverage,
};
const parameter = (name, where, schema, required = true) => ({ name, in: where, required, schema });
const shared = [parameter('X-Tenant-ID', 'header', uuid), parameter('run', 'path', uuid)];
const operation = (operationId, extra, success, schema, additional = {}) => ({
  operationId, security: [{ customerSession: [] }, { nativeBearer: [] }], parameters: [...shared, ...extra],
  responses: {
    [success]: { description: 'Current identity, project, private ownership and original source lineage are required.', content: { 'application/json': { schema: ref(schema) } } },
    ...Object.fromEntries([400,401,402,403,404,409,422,429,503].map((s) => [s, { description: 'Rejected by input, authentication, source lifecycle, budget, version or capacity controls; no website write is executed.' }])),
  }, ...additional,
});
const base = '/v1/seo/audits/{run}/change-tasks';
const download = operation('downloadSeoChangeDraft', [parameter('change','path',uuid),parameter('format','query',{type:'string',enum:['json','html']})], 200, 'SeoChangeDraft');
download.responses[200].content['text/html'] = { schema: {type:'string'}, description: 'Server-escaped immutable draft HTML; proposed source remains text.' };
download.responses[200].headers = {
  'X-Content-SHA256': { schema: hash }, 'Content-Disposition': { schema: text }, 'Cache-Control': { schema: { type:'string', const:'private, no-store' } },
};
const files = ['src/seo-change-model.ts','src/seo-changes.ts','src/seo-source-access.ts','src/seo-reports.ts','src/worker.ts','src/assets.ts','migrations/080-seo-change-tasks.sql'];
const contract = {
  openapi: '3.1.0', info: {title:'CopyPaste source-governed website change tasks',version:'1.0.0',description:'Additive UC05 save-change draft workflow. Four operations; no CMS write, automatic publishing, full TaskDTO, GEO or production qualification. Synthetic data remains explicitly labelled.'},
  'x-normative-source-sha256': sha(await read('docs/contracts/openapi.json')),
  'x-scoped-seo-contract-sha256': sha(oldBytes),
  'x-platform-source-sha256': Object.fromEntries(await Promise.all(files.map(async (f) => [f,sha(await read('dev/copypaste-platform/'+f))]))),
  paths: {
    [base]: {
      post: operation('createSeoChangeTask',[parameter('Idempotency-Key','header',{type:'string',minLength:16,maxLength:128,pattern:'^[\\w:-]+$'})],202,'SeoChange',{requestBody:{required:true,content:{'application/json':{schema:ref('SeoChangeCreateInput')}}}}),
      get: operation('listSeoChangeTasks',[parameter('offset','query',integer,false)],200,'SeoChangeList'),
    },
    [base+'/{change}']: {get:operation('getSeoChangeTask',[parameter('change','path',uuid)],200,'SeoChangeDetail')},
    [base+'/{change}/download']: {get:download},
  },
  components: {securitySchemes:old.components.securitySchemes,schemas},
};
await writeFile(path.join(root,'docs/contracts/seo-change-tasks-openapi.json'),JSON.stringify(contract,null,2)+'\n');
console.log(JSON.stringify({operations:4,schemas:Object.keys(schemas).length,source_files:files.length}));
