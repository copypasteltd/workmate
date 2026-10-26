"""Create an additive stage 103 contract from the actual strict input schemas."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
source = """import {z} from 'zod'; import {dataCommand,jobConfirmation,jobControl} from './src/admin-data-model.ts'; process.stdout.write(JSON.stringify({Command:z.toJSONSchema(dataCommand),Confirmation:z.toJSONSchema(jobConfirmation),Control:z.toJSONSchema(jobControl)}));"""
schemas = json.loads(subprocess.check_output(['node', '--import', 'tsx', '--input-type=module', '-e', source], cwd=ROOT/'dev/copypaste-platform'))
for schema in schemas.values(): schema.pop('$schema', None)
schemas['Command']['description'] = 'Strict source-specific filters: state only applies to users; audit rejects project_id/user_id. Date end must follow start. Account batches contain unique UUIDs, at most 100, and cannot close or reopen closed accounts. Export previews select at most 10000 records without truncation.'
paths = {}
uid = {'type': 'string', 'format': 'uuid'}
def query(name, schema, description=''): return {'name': name, 'in': 'query', 'schema': schema, 'description': description}
def add(path, method, title, permissions, body=None, parameters=None, accepted=False):
    op = {'summary': title, 'security': [{'adminSession': []}], 'x-permissions': permissions,
          'x-current-scope-and-field-checks': True, 'x-recent-mfa-seconds': 600,
          'responses': {'202' if accepted else '200': {'description': 'Queued persistent job' if accepted else 'Authorized result'}, '400': {'description': 'Invalid strict schema, filter, CSRF/origin or key'}, '401': {'description': 'Admin session required'}, '403': {'description': 'Current permission, binding or MFA rejected'}, '404': {'description': 'Owned authorized job or target not found'}, '409': {'description': 'Stale preview/target/revision/policy, reused preview/key, terminal state, oversized export or partial file not accepted'}, '410': {'description': 'Snapshot expired'}}}
    params = list(parameters or [])
    if '{id}' in path: params.insert(0, {'name': 'id', 'in': 'path', 'required': True, 'schema': uid})
    if accepted: params.append({'name': 'Idempotency-Key', 'in': 'header', 'required': True, 'schema': {'type': 'string', 'minLength': 16, 'maxLength': 128, 'pattern': r'^[\w:-]+$'}})
    if params: op['parameters'] = params
    if method == 'post': op['x-csrf-and-origin-check'] = True
    if body: op['requestBody'] = {'required': True, 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/'+body}}}}
    paths.setdefault(path, {})[method] = op
base='/v1/admin/data-jobs'
add(base+'/previews','post','Freeze authorized record IDs, versions, field projection and encrypted rows',['admin.jobs.create','admin.exports.create OR admin.users.status.write','source read permission'],'Command')
add(base,'post','Confirm the exact session-bound preview and queue the job',['admin.jobs.create','source action and read permissions'],'Confirmation',accepted=True)
add(base,'get','List this administrator\'s jobs under current bindings',['admin.jobs.read'],parameters=[query('limit',{'type':'integer','minimum':1,'maximum':100,'default':30}),query('before',{'type':'string','format':'date-time'},'Paired with before_id for stable tuple pagination'),query('before_id',uid,'Paired with before')])
add(base+'/{id}','get','Read frozen manifest, paginated item outcomes and the latest 50 immutable events',['admin.jobs.read','source read/action permission'],parameters=[query('offset',{'type':'integer','minimum':0,'default':0}),query('limit',{'type':'integer','minimum':1,'maximum':100,'default':50})])
add(base+'/{id}/cancel','post','Cancel pending items; preserve all committed effects',['admin.jobs.read'],'Control')
add(base+'/{id}/reauthorize','post','Bind pending work to a fresh owner session while preserving the original access/policy',['admin.jobs.read','admin.jobs.create','source permissions'],'Control')
add(base+'/{id}/retry-previews','post','Review current versions of failed targets only; confirmation creates one child per parent',['admin.jobs.read','admin.jobs.create','source permissions'],'Control')
add(base+'/{id}/download','get','Recheck each frozen record and current field/download authority, then return CSV or exact manifest',['admin.jobs.read','admin.exports.create','admin.exports.download','source read permission'],parameters=[query('format',{'type':'string','enum':['csv','manifest'],'default':'csv'}),query('accept_partial',{'type':'string','enum':['true']},'Explicit opt-in for a partially successful export; failed records are excluded')])
paths[base+'/{id}/download']['get']['responses']['200']={'description':'Private no-store attachment; UTF-8 BOM CSV neutralizes leading spreadsheet formulas, or JSON manifest declares exact IDs, hashes, counts and filters','content':{'text/csv':{'schema':{'type':'string'}},'application/json':{'schema':{'type':'object'}}}}
out={'openapi':'3.1.0','info':{'title':'Workmate persistent Admin data jobs','version':'103.1','description':'Additive implemented contract. Legacy synchronous endpoints remain for compatibility; the product UI uses these persistent routes. Only frozen, whitelisted data is exported. Snapshots expire after 15 minutes; previews after 5 minutes. This scope does not add financial/VIP bulk mutations or certify live AI quality.'},'paths':paths,'components':{'schemas':schemas,'securitySchemes':{'adminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'}}}}
with (ROOT/'docs/contracts/admin-data-jobs-openapi.json').open('x',encoding='utf-8',newline='\n') as f: json.dump(out,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'paths':len(paths),'methods':sum(len(v) for v in paths.values()),'schemas':len(schemas)}))
