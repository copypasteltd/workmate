"""Preserve the whole failed round, then prepare all collected corrections."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json
R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';W=R/'dev/copypaste-web';D=R/'dev/copypaste-desktop';L=R/'dev/copypaste-delivery';Q=R/'docs/quality/integrated-round-204'
result=json.loads((L/'.data/integrated-204-v5/verification.json').read_text('utf-8'))
assert result['status']=='failures_for_integrated_debugging'
log=(L/'.data/integrated-204-v5/platform-test.log').read_text('utf-8')
assert 'syntax error at end of input' in log and 'applied migration 165' not in log

def fresh(p,text):
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(text)
def edit(p,old,new):
 raw=p.read_bytes();text=raw.decode().replace('\r\n','\n');assert old in text,(p,old[:60]);text=text.replace(old,new);p.write_bytes(text.replace('\n','\r\n').encode() if b'\r\n' in raw else text.encode())

# The failed draft never committed. Retain its exact bytes, do not replace an
# applied migration or conceal the hash/failed attempt under the original name.
source=P/'migrations/165-native-transaction-lease-compatibility.sql'
failed=Q/'failed-sql165-v1.txt';assert not failed.exists();raw=source.read_bytes()
assert R in source.resolve().parents and R in failed.resolve().parents
source.rename(failed)
sql=raw.decode().replace('\r\n','\n').replace("'public.task_live_lease_until(t)<=CASE WHEN t.execution_location=''desktop'' THEN now() ELSE clock_timestamp() END'", "'public.task_live_lease_until(t)<=(CASE WHEN t.execution_location=''desktop'' THEN now() ELSE clock_timestamp() END)'")
assert sql!=raw.decode().replace('\r\n','\n')
fresh(P/'migrations/165-native-transaction-lease-compatibility-v2.sql',sql)
for p in [W/'src/task-tool-feedback.css',D/'renderer/src/task-tool-feedback.css']:
 edit(p,'.task-tool-feedback { min-width: 0; overflow-wrap: anywhere; }','.notice.task-tool-feedback { display: block; min-width: 0; overflow-wrap: anywhere; }\n.task-tool-feedback > strong { display: block; }')

ui=(L/'scripts/qualify-tool-feedback-ui-204-v2.mjs').read_text('utf-8').replace('feedback-ui-v2','feedback-ui-v3').replace('204-v2-tool-feedback','204-v3-tool-feedback').replace("'204-v2',()=>page.screenshot","'204-v3',()=>page.screenshot")
ui=ui.replace("await recording.start();", "await recording.start();await page.waitForTimeout(800);")
ui=ui.replace("report.checks.push('Current failure retained after eight hundred later progress events');", "report.checks.push('Current failure retained after eight hundred later progress events');await page.waitForTimeout(800);")
ui=ui.replace("await page.getByText('此項工作尚未完整交付',{exact:true}).waitFor();", "await page.getByText('此項工作尚未完整交付',{exact:true}).waitFor();await page.waitForTimeout(800);")
ui=ui.replace("await page.getByText('TOOL_INPUT_INVALID · 204a204b204c204d',{exact:true}).waitFor();", "await page.getByText('TOOL_INPUT_INVALID · 204a204b204c204d',{exact:true}).waitFor();await page.waitForTimeout(800);")
ui=ui.replace("assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);", """assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const readable=await page.locator('.task-tool-feedback').evaluate(panel=>{const r=panel.getBoundingClientRect(),h=panel.querySelector('strong').getBoundingClientRect(),p=panel.querySelector('p').getBoundingClientRect();return{panel:r.width,heading:h.width,headingBottom:h.bottom,paragraphTop:p.top};});
  assert.ok(readable.heading>readable.panel*.8,'Full-width readable message heading');assert.ok(readable.paragraphTop>=readable.headingBottom-.5,'Message body follows heading vertically');""")
ui=ui.replace("report.checks.push('Actual success event removes unresolved delivery feedback; bilingual dual themes have no horizontal overflow');", "report.checks.push('Actual success clears unresolved feedback; bilingual dual themes use readable vertical message blocks with no horizontal overflow');assert.ok(report.recordings[0].distinct_frames>=4,'Interaction recording retains distinct issue, finish, reference and recovery states');")
ui=ui.replace("await browser?.close();await server.close();report.finished_at", "await browser?.close();report.owned_browser_closed=true;await server.close();report.owned_local_server_closed=true;report.finished_at")
fresh(L/'scripts/qualify-tool-feedback-ui-204-v3.mjs',ui)

edit(L/'scripts/activate-downloads-204-v1.sh',"assert manifest['stage']==203","assert manifest['stage']==204")
edit(L/'scripts/qualify-public-stream-204-v1.mjs','/downloads/releases/20301/','/downloads/releases/20401/')
edit(L/'scripts/finalize-release-metadata-204-v1.mjs','integrated-204-v5','integrated-204-v6')
edit(L/'scripts/prepare-public-downloads-204-v1.py',"copypaste-desktop/.data/deployment-204-v1/release","copypaste-desktop/.data/deployment-204-v2/release")
edit(L/'scripts/qualify-live-marketing-review-204-v1.mjs',".data/deployment-204-v1/release/win-unpacked",".data/deployment-204-v2/release/win-unpacked")
pack=(D/'scripts/package-integrated-204-v1.mjs').read_text('utf-8').replace('deployment-204-v1','deployment-204-v2').replace('integrated-204-v3','integrated-204-v6')
fresh(D/'scripts/package-integrated-204-v2.mjs',pack)
edit(R/'docs/tools/publish-integrated-round-204-v1.py',"migrations/165-native-transaction-lease-compatibility.sql","migrations/165-native-transaction-lease-compatibility-v2.sql")
record=(R/'docs/tools/record-integrated-code-batch-204-v3.py').read_text('utf-8').replace('implementation-batch-v3.json','implementation-batch-v4.json')
fresh(R/'docs/tools/record-integrated-code-batch-204-v4.py',record)
report={'stage':204,'at':datetime.now(timezone.utc).isoformat(),'failed_verifier_v4':{'failure':'Verifier launched before async source inventory completed; no build/test/server change','retained_script':'dev/copypaste-delivery/scripts/verify-integrated-round-204-v4.mjs'},'failed_verifier_v5':result,'failed_unapplied_sql165':{'path':failed.relative_to(R).as_posix(),'sha256':hashlib.sha256(raw).hexdigest(),'completed_applications':0},'corrections':['Parenthesize the SQL CASE expression embedded in the two original PL/pgSQL IF guards','Make status feedback readable as vertical blocks at narrow widths; retain prior automated pass and manual visual rejection separately','Record legible real UI capture intervals and assert four distinct interaction states','Correct new download stage204 and immutable public path20401 before deployment','Rebuild changed clients and create a new immutable packaging attempt rather than overwrite prior packages']}
fresh(Q/'collected-build-corrections-v4.json',json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'whole_collected_batch_prepared','schema':165,'failed_sql_preserved':True,'server_changes':False}))
