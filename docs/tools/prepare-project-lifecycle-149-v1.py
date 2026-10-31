"""Create additive, immutable qualification tools; never rewrite prior attempts."""
from pathlib import Path
import json

root = Path(r"D:\dev\copypasted\自有agent")
delivery = root / "dev/copypaste-delivery"

def put(relative, content):
    p = root / relative
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(content)

def replace_once(s, old, new):
    assert s.count(old) == 1, old[:160]
    return s.replace(old, new)

put("dev/copypaste-delivery/scripts/project-lifecycle-149-evidence.mjs", '''import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
// Existing content-addressed evidence is reused only after exact byte equality.
export async function sourceObject(bytes) {
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const prior='evidence/marketing-import-148/objects/'+sha256+'.blob';
 try {assert.deepEqual(await readFile(prior),bytes);return {path:prior,sha256};}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const target='evidence/project-lifecycle-149/objects/'+sha256+'.blob';
 await mkdir(path.dirname(target),{recursive:true});
 try{await writeFile(target,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(target),bytes);}
 return {path:target,sha256};
}
''')

s = (delivery / "scripts/qualify-marketing-import-148-v3.mjs").read_text(encoding="utf-8")
s = s.replace('import path from "node:path";', 'import path from "node:path";\nimport {sourceObject} from "./project-lifecycle-149-evidence.mjs";')
s = s.replace('evidence/marketing-import-148', 'evidence/project-lifecycle-149')
s = s.replace('qualify-marketing-import-148-v3.mjs', 'qualify-project-lifecycle-149-v1.mjs')
a = s.index('async function object(bytes) {')
b = s.index('async function snapshot(', a)
s = s[:a] + 'async function object(bytes) { return sourceObject(bytes); }\n' + s[b:]
s = replace_once(s, '["scripts/qualify-project-lifecycle-149-v1.mjs",', '["scripts/qualify-project-lifecycle-149-v1.mjs", "scripts/project-lifecycle-149-evidence.mjs",')
s = s.replace('evidence/functional-closure-147/backend-', 'evidence/marketing-import-148/backend-')
a = s.index('    const tests=[')
b = s.index(';', a)
s = s[:a] + '    const tests=["tests/project-management-149-v1.test.ts"]' + s[b:]
s = s.replace('qualifying explicit campaign formats, exact facts, original byte identity, canonical snapshots, private specialist tools and source authority with explicit synthetic customer data', 'qualifying project management, last-active restoration, permission races and exact idempotent state with explicit synthetic customer data')
s = s.replace('Targeted real SQL/HTTP, original import and XLSX checks plus explicit date/number/dialect/encoding conventions. User-directed first-release smoke omits broad historical and native-model regression; Stage147 core journeys remain separately historical. No production service or whole-product acceptance claimed.', 'Targeted real SQL/HTTP project directory, edit/archive/restore, cross-tenant isolation, revoked authority behind real locks, idempotent replay and retained contents. Broad historical, model and unchanged-client regression omitted under the user-directed fast-release policy. Frozen v0.1.0-rc.1 is unchanged; no aggregate erasure or whole-product acceptance claimed.')
put("dev/copypaste-delivery/scripts/qualify-project-lifecycle-149-v1.mjs", s)

s = (delivery / "scripts/build-marketing-clients-148-v1.mjs").read_text(encoding="utf-8")
s = s.replace("import path from 'node:path';", "import path from 'node:path';\nimport {sourceObject} from './project-lifecycle-149-evidence.mjs';")
s = s.replace('evidence/marketing-import-148', 'evidence/project-lifecycle-149').replace('release/marketing-import-148-', 'release/project-lifecycle-149-')
old = "const b=await readFile(path.join(repo,file)),digest=sha(b),object=base+'/objects/'+digest+'.blob';if(archive){try{await writeFile(object,b,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),b);}}files['copypaste-'+name+'/'+file]={sha256:digest,...(archive?{path:object}:{})};"
new = "const b=await readFile(path.join(repo,file));files['copypaste-'+name+'/'+file]=archive?await sourceObject(b):{sha256:sha(b)};"
s = replace_once(s, old, new)
s = replace_once(s, '}}return files;}', "}}for(const f of['scripts/build-project-clients-149-v1.mjs','scripts/project-lifecycle-149-evidence.mjs']){const b=await readFile(f);files['copypaste-delivery/'+f]=archive?await sourceObject(b):{sha256:sha(b)};}return files;}")
s = s.replace('Current Web and unsigned frameless Windows Desktop marketing import build; unchanged Extension runtime retains its separately labelled Stage147 build evidence. Actual interaction qualification is recorded separately.', 'Current Web and unsigned frameless Windows Desktop project-management build. Native surface boundary checks preserve Desktop-local/Extension-cloud execution. Unchanged Admin/Extension evidence remains historical. Actual project interactions are qualified separately; frozen release artifacts remain unchanged.')
put("dev/copypaste-delivery/scripts/build-project-clients-149-v1.mjs", s)

s = (delivery / "scripts/qualify-marketing-release-ui-148-v4.mjs").read_text(encoding="utf-8")
s = s.replace("import path from 'node:path';", "import path from 'node:path';\nimport {sourceObject} from './project-lifecycle-149-evidence.mjs';")
s = s.replace('marketing-import-148', 'project-lifecycle-149').replace('qualify-marketing-release-ui-148-v4.mjs', 'qualify-project-lifecycle-ui-149-v1.mjs').replace('qa-marketing-release-148-v4.ts', 'qa-project-lifecycle-149-v1.ts')
old="const bytes=await readFile(path.join(repo,namePath)),digest=sha(bytes),object=base+'/objects/'+digest+'.blob';if(archive){try{await writeFile(object,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),bytes);}}files['copypaste-'+name+'/'+namePath]={sha256:digest,...(archive?{path:object}:{})};"
s=replace_once(s,old,"const bytes=await readFile(path.join(repo,namePath));files['copypaste-'+name+'/'+namePath]=archive?await sourceObject(bytes):{sha256:sha(bytes)};")
old="const bytes=await readFile(file),digest=sha(bytes),object=base+'/objects/'+digest+'.blob';if(archive){try{await writeFile(object,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),bytes);}}files['copypaste-delivery/'+file]={sha256:digest,...(archive?{path:object}:{})};"
s=replace_once(s,old,"const bytes=await readFile(file);files['copypaste-delivery/'+file]=archive?await sourceObject(bytes):{sha256:sha(bytes)};")
s=s.replace("'scripts/record-workmate-media.ts']", "'scripts/record-workmate-media.ts','scripts/build-project-clients-149-v1.mjs','scripts/project-lifecycle-149-evidence.mjs']")
s=s.replace('evidence/functional-closure-147/ui-', 'evidence/marketing-import-148/ui-')
s=s.replace('User-directed first frozen release smoke: actual Web OTP and packaged frameless Desktop PKCE, original localized file upload, explicit conventions, reviewed exact facts and a durable analysis snapshot. No model execution in this smoke; Stage147 real local/cloud Codex and native right Side Panel evidence remains historical. Broad regression deliberately omitted.', 'Focused actual Web OTP/onboarding and packaged frameless Desktop PKCE. Edit, archive-last and restore preserve identity and access boundaries; delayed stale active-list response cannot resurrect an archived selection. No model execution; historical Stage147/148 core flows remain separately labelled. No full product or aggregate erasure acceptance claimed; frozen release unchanged.')
put("dev/copypaste-delivery/scripts/qualify-project-lifecycle-ui-149-v1.mjs", s)

params = [{"name":n,"in":"path","required":True,"schema":{"type":"string","format":"uuid"}} for n in ("tenant","project")]
project = {"type":"object","required":["id","tenant_id","name","description","archived","created_at"],"properties":{
    "id":{"type":"string","format":"uuid"},"tenant_id":{"type":"string","format":"uuid"},"name":{"type":"string"},"description":{"type":"string"},"archived":{"type":"boolean"},"created_at":{"type":"string","format":"date-time"}}}
responses={str(code):{"description":text} for code,text in [(400,"Invalid fields or mismatched optional X-Tenant-ID"),(401,"Sign in required"),(403,"Current owner/admin role required"),(404,"Workspace or project unavailable"),(409,"PROJECT_CHANGED or conflicting idempotency key")]}
contract={"openapi":"3.1.0","info":{"title":"Workmate project management","version":"1.0.0","description":"Management-only archived-project access. Normal projectAccess remains active-only. Archiving gates availability while archived; it is not durable task cancellation or data erasure. Cancel work separately when required."},"paths":{
 "/v1/tenants/{tenant}/project-directory":{"get":{"operationId":"listManagedProjects","security":[{"customerSession":[]}],"parameters":[params[0]]+[
  {"name":"state","in":"query","schema":{"type":"string","enum":["active","archived","all"],"default":"active"}},
  {"name":"search","in":"query","schema":{"type":"string","maxLength":160},"description":"Case-insensitive literal substring, not SQL wildcard syntax"},
  {"name":"page","in":"query","schema":{"type":"integer","minimum":1,"maximum":10000,"default":1}},
  {"name":"page_size","in":"query","schema":{"type":"integer","minimum":1,"maximum":100,"default":20}}],"responses":{**responses,"200":{"description":"Current owner/admin project directory, Cache-Control no-store","content":{"application/json":{"schema":{"type":"object","properties":{"items":{"type":"array","items":{"$ref":"#/components/schemas/Project"}},"total":{"type":"integer"},"page":{"type":"integer"},"page_size":{"type":"integer"}}}}}}}}},
 "/v1/tenants/{tenant}/projects/{project}":{"patch":{"operationId":"updateManagedProject","security":[{"customerSession":[],"csrfToken":[]}],"parameters":params+[{"name":"Idempotency-Key","in":"header","schema":{"type":"string"},"description":"Optional for legacy compatibility; first-party clients persist a key for each exact intent. Same key/body returns the current state without reapplying an obsolete mutation; current authorization is checked again."}],"requestBody":{"required":True,"content":{"application/json":{"schema":{"type":"object","additionalProperties":False,"properties":{
   "name":{"type":"string","minLength":1,"maxLength":160},"description":{"type":"string","maxLength":2000},"archived":{"type":"boolean"},"expected_archived":{"type":"boolean"},"expected_name":{"type":"string","maxLength":160},"expected_description":{"type":"string","maxLength":2000}},"anyOf":[{"required":[p]} for p in ("name","description","archived")]}}}},"responses":{**responses,"200":{"description":"Current project, including replay after subsequent undo. Identity/content/grants preserved; revoked access is not recreated.","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Project"}}}}}}}},
 "components":{"securitySchemes":{"customerSession":{"type":"apiKey","in":"cookie","name":"cp_session"},"csrfToken":{"type":"apiKey","in":"header","name":"X-CSRF-Token"}},"schemas":{"Project":project}}}
put("dev/copypaste-platform/contracts/project-management-openapi.json", json.dumps(contract,ensure_ascii=False,indent=2)+"\n")
print("Created 149 verifiers and additive API contract; previous artifacts unchanged.")
