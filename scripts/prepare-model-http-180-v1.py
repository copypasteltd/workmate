"""Prepare task-scoped runtime and verification scripts without changing historical evidence."""
from pathlib import Path

D = Path(__file__).resolve().parents[1]
S = D / 'scripts'
(D / '.data/deployment-180').mkdir(parents=True, exist_ok=True)

def create(name, text):
    with (S / name).open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)

runner = (S / 'test-model-management-179-v5.mjs').read_text(encoding='utf-8')
runner = runner.replace('.data/model-management-179', '.data/model-http-180').replace('stage:179', 'stage:180')
runner = runner.replace('"tests/model-management-179-v5.test.ts",', '"tests/model-http-180-v1.test.ts","tests/model-management-179-v5.test.ts",')
create('test-model-http-180-v1.mjs', runner)

package = (S / 'package-model-management-179-v1.py').read_text(encoding='utf-8')
package = package.replace('deployment-179', 'deployment-180').replace('model-management-179', 'model-http-180')
package = package.replace("'stage':179", "'stage':180").replace("'previous_overlay':'model-connections-178'", "'previous_overlay':'model-management-179'")
create('package-model-http-180-v1.py', package)

browser = (S / 'qualify-model-management-179-v2.mjs').read_text(encoding='utf-8')
prefix = browser[:browser.index(' stage="seed disposable model";')]
prefix = prefix.replace('privateDir=path.resolve(".data/deployment-179")', 'privateDir=path.resolve(".data/deployment-180")')
prefix = prefix.replace('stage:179', 'stage:180').replace('"assets/screenshots/179-"', '"assets/screenshots/180-"')
prefix = prefix.replace('assert.equal((await health.json()).model_management,"editable")', 'assert.equal((await health.json()).model_transport,"http_and_https")')
suffix = ''' stage="check current gpt-6-luna";
 await navigate(page,ADMIN+"/catalog?view=capabilities");
 const listed=await page.request.get(ADMIN+"/v1/admin/capability-releases?view=active&limit=100");
 assert.equal(listed.status(),200);const listing=await listed.json();
 const current=listing.items.filter(x=>x.document.model_alias==="gpt-6-luna");
 assert.equal(current.length,1,"Expected one current gpt-6-luna entry");
 const model=current[0];receipt.release_id=model.id;receipt.model_alias=model.document.model_alias;
 receipt.base_url=model.document.upstream.base_url;
 assert.ok(receipt.base_url.startsWith("http:"));
 await page.locator('[data-release-id="'+model.id+'"]').getByRole("button",{name:"Configuration & validation",exact:true}).click();
 await page.getByRole("button",{name:"Test this model connection",exact:true}).waitFor();
 await shot(page,"http-model-before-check");
 const [checked]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/connection-test")&&r.request().method()==="POST"),page.getByRole("button",{name:"Test this model connection",exact:true}).click()]);
 assert.equal(checked.status(),200);const result=await checked.json();receipt.connection_result=result;
 assert.equal(result.reachable,true);assert.equal(result.model_available,true);
 pass("current gpt-6-luna public HTTP connection authenticates and lists the requested model");
 await page.getByText("Connection and key work; the model is listed.",{exact:true}).waitFor();
 await shot(page,"http-model-connected");
 const detail=await(await page.request.get(ADMIN+"/v1/admin/capability-releases/"+model.id)).json();
 assert.equal(detail.version,model.version);assert.equal(detail.management_revision,model.management_revision);
 assert.equal(detail.document.upstream.base_url,receipt.base_url);
 pass("connection test preserves the current configuration, key binding and publication state");
 receipt.video=await page.video().path();
}catch(e){failure=e;receipt.failure={stage,type:e.name,message:e.message.split("\\n")[0]};}
finally{
 for(const c of contexts.reverse())await c.close().catch(()=>{});
 if(browser)await browser.close().catch(()=>{});
 receipt.browser_closed=true;receipt.status=failure?"failed":"passed";receipt.finished_at=new Date().toISOString();
 await writeFile(path.join(run,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
 console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,"receipt.json"),failure:receipt.failure}));
}
if(failure)process.exitCode=1;
'''
create('qualify-model-http-180-v1.mjs', prefix + suffix)

renderer = (S / 'render-model-management-media-179-v1.py').read_text(encoding='utf-8')
renderer = renderer.replace('deployment-179', 'deployment-180').replace('model-management-179', 'model-http-180')
renderer = renderer.replace("len(r['media'])==3", "len(r['media'])==2").replace("'179-model-management.'", "'180-model-http.'")
renderer = renderer.replace("['model-form','saved-edit','deleted-model']", "['before-check','connected']").replace("'stage':179", "'stage':180")
create('render-model-http-media-180-v1.py', renderer)
print('Prepared stage180 native checks, runtime package, actual browser journey and media renderer.')
