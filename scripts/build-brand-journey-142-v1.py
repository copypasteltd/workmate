"""Create new, reviewable journey sources; historical executed attempts stay byte-identical."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
old = (HERE / 'qa-creative-packages-140-v6.ts').read_text(encoding='utf-8')
text = old.replace('creative-packages-140', 'creative-brand-142')
def replace_section(start, end, replacement):
    global text
    assert text.count(start) == 1 and text.count(end) == 1, (start, end)
    a, b = text.index(start), text.index(end)
    assert a < b
    text = text[:a] + replacement + text[b:]

replace_section('  const source = await fixtures.historyOk', '  async function login', '''  const save = async (p: string, name: string, color: string) => {
    const c = createCanvas(64,64), g = c.getContext("2d"); g.fillStyle=color; g.fillRect(0,0,64,64);
    return system.db.tx((tx: any) => saveAsset(tx,system.storage,{tenant,project:p,user:owner.id,name,mime:"image/png",bytes:c.toBuffer("image/png")}),tenant,false,owner.id);
  };
  const originalLogo = await save(project,"Original Logo.png","#15171a"), targetLogo = await save(target.id,"Destination Logo.png","#2352df");
  const brandDefinition = (destination: boolean) => ({schema_version:2,name:destination?"CopyPaste Destination":"CopyPaste Original",colors:destination?["#e7eefc","#15171a","#2352df"]:["#f6f6f4","#15171a"],tone:"Clear and useful",
    font_bindings:[{key:destination?"display":"body",label:"Noto Sans TC",source:{builtin:"noto-sans-tc"},rights:{source:"Noto project",license:"SIL Open Font License 1.1",channels:["web"],valid_until:null}}],
    facts:[{key:destination?"offer":"price",kind:"price",text:destination?"New season":"Launch offer",amount_minor:destination?19800:12800,currency:"HKD"}],
    logos:[{key:destination?"identity":"mark",asset_id:destination?targetLogo.id:originalLogo.id,version:1,usage:"Campaign Logo",min_width:64,clear_space:16}],locales:["en-HK"],channels:["web"]});
  const sourceBrand=await fixtures.historyOk(system,owner,"POST",base+"/brand/definitions",brandDefinition(false)),
    targetBrand=await fixtures.historyOk(system,owner,"POST",destination+"/brand/definitions",brandDefinition(true));
  const brandChoiceId=(await system.db.control.query("SELECT id FROM brand_profile_versions WHERE brand_id=$1 AND version=1",[targetBrand.id])).rows[0].id;
  const source = await fixtures.historyOk(system,owner,"POST",base+"/creative",{name:"Original brand campaign",body:{width:640,height:800,background:"#f6f6f4",brand:{id:sourceBrand.id,version:1,channel:"web",locale:"en-HK"},layers:[
    {type:"image",asset_id:originalLogo.id,version:1,x:32,y:32,width:96,height:96},
    {type:"image",asset_id:media.id,version:1,x:32,y:150,width:576,height:350},
    {type:"text",text:"Launch price",font_key:"body",fact_key:"price",x:32,y:570,font_size:26,color:"#15171a"},
    {type:"text",text:"MAKE SPACE FOR MORE.",font_key:"body",x:32,y:640,font_size:22,color:"#15171a"}]}});
  const raw=await system.app.inject({method:"GET",url:`${base}/creative-project-packages/${source.id}?expected_version=1`,headers:{cookie:owner.cookie,"x-tenant-id":tenant}});
  assert.equal(raw.statusCode,200,raw.body.slice(0,200));
  const inputFiles={canvas:path.join(owned,"brand-canvas.zip")}; await writeFile(inputFiles.canvas,raw.rawPayload,{flag:"wx"});
  assert.equal(JSON.parse(Buffer.from(unzipSync(raw.rawPayload)["manifest.json"]).toString()).brand_requirements.source_name,"CopyPaste Original");
  archives.push({kind:"brand_canvas",purpose:"actual source export used across different projects",path:path.relative(delivery,inputFiles.canvas).replaceAll("\\\\","/"),sha256:sha(raw.rawPayload),files:Object.keys(unzipSync(raw.rawPayload)).length});
''')
replace_section('  async function restoreUI', '  stage = "Web restore', '''  async function restoreUI(page: Page,file: string,name: string,component: string){
    const region=page.getByRole("region",{name:"Project packages & restore",exact:true}); await region.waitFor();
    await region.getByRole("checkbox").first().check(); await region.locator('input[type="file"]').setInputFiles(file);
    await region.getByRole("button",{name:"Upload or resume",exact:true}).click(); await region.locator("[data-package-preview]").waitFor({timeout:60000});
    await region.getByLabel("New project name",{exact:true}).fill(name);
    const brands=region.getByLabel("Fixed destination brand version",{exact:true});
    await brands.locator(`option[value="${brandChoiceId}"]`).waitFor({state:"attached"}); await brands.selectOption(brandChoiceId);
    await region.getByLabel("fonts:body",{exact:true}).selectOption("display");
    await region.getByLabel("facts:price",{exact:true}).selectOption("offer");
    await region.getByLabel("logos:mark",{exact:true}).selectOption("identity");
    await region.getByText("Apply destination brand colors (optional)",{exact:true}).click();
    await region.getByLabel("color:#f6f6f4",{exact:true}).selectOption("#e7eefc");
    await region.getByRole("button",{name:"Review brand changes",exact:true}).click(); await region.locator("[data-brand-review]").waitFor();
    assert.match(await region.locator("[data-brand-review]").innerText(),/198\\.00/);
    await region.getByRole("checkbox",{name:/I confirm media rights for this project/}).check();
    assert.equal(await region.getByRole("button",{name:"Restore a new project",exact:true}).isDisabled(),true);
    await region.getByRole("checkbox",{name:/I reviewed fonts, facts, Logos/}).check();
    await region.locator("[data-brand-review]").scrollIntoViewIfNeeded(); await shot(component,page,"brand-mapping-reviewed-en");
    await region.getByRole("button",{name:"Restore a new project",exact:true}).click(); await region.locator("[data-package-restored]").waitFor();
    const result=(await system.db.control.query("SELECT * FROM creative_projects WHERE project_id=$1 AND name=$2",[target.id,name])).rows[0];
    assert.equal(result.body.brand.id,targetBrand.id); assert.equal(result.body.layers[0].asset_id,targetLogo.id); assert.match(result.body.layers[2].text,/198\\.00/); assert.equal(result.body.background,"#e7eefc");
    return result;
  }
''')
text=text.replace('definition.layers[1].text = "Restored. Edited. Ready."','definition.layers[3].text = "Restored. Edited. Ready."')
text=text.replace('verified-restore-review-en','brand-mapping-reviewed-en')
# Keep real OTP/PKCE and frameless process launching, then exercise the branded canvas.
replace_section('  const nativeRestored = await restoreUI', '  for (const width of [1360, 960])', '''  const nativeRestored=await restoreUI(desktop,inputFiles.canvas,"Desktop restored brand campaign","desktop"); assert.equal(nativeRestored.kind,"poster");
  const nativeCard=desktop.locator("article.project-card").filter({has:desktop.getByRole("heading",{name:"Desktop restored brand campaign",exact:true})});
  await nativeCard.getByRole("button",{name:"Edit layered source",exact:true}).click(); const editor=desktop.getByRole("dialog"), sourceInput=editor.locator('textarea[name="source"]');
  const nativeDefinition=JSON.parse(await sourceInput.inputValue()); nativeDefinition.layers[3].text="A new chapter. Made here."; await sourceInput.fill(JSON.stringify(nativeDefinition));
  await editor.getByRole("button",{name:"Save new version",exact:true}).click(); await editor.waitFor({state:"hidden"});
  await nativeCard.getByRole("button",{name:"PNG",exact:true}).click(); await nativeCard.locator(".design-export-result").waitFor(); await nativeCard.scrollIntoViewIfNeeded();
  await shot("desktop",desktop,"restored-brand-rendered-en");
  const packageRegion=desktop.getByRole("region",{name:"Project packages & restore",exact:true}); await packageRegion.getByRole("button",{name:"Refresh project versions",exact:true}).click();
  await until(()=>packageRegion.locator(`option[value="${nativeRestored.id}"]`).textContent(),v=>!!v?.includes("v2"),"current destination brand canvas version");
  await packageRegion.getByRole("combobox").selectOption(nativeRestored.id); await packageRegion.getByRole("button",{name:"Download complete project ZIP",exact:true}).click();
  const savedBytes=await until(async()=>{try{return await readFile(savedZip);}catch{return null;}},v=>!!v?.length,"native fixed-version brand ZIP save");
  const nativeManifest=JSON.parse(Buffer.from(unzipSync(savedBytes)["manifest.json"]).toString()); assert.equal(nativeManifest.brand_requirements.source_name,"CopyPaste Destination");
  archives.push({kind:"brand_canvas",purpose:"actual packaged Desktop export after brand restoration and editing",path:path.relative(delivery,savedZip).replaceAll("\\\\","/"),sha256:sha(savedBytes),files:Object.keys(unzipSync(savedBytes)).length});
''')
text=text.replace('await shot("web", web, "restored-edited-rendered-en"); await stopRecording();', '''await shot("web", web, "restored-edited-rendered-en");
  const webPackages=web.getByRole("region",{name:"Project packages & restore",exact:true}); await webPackages.getByRole("button",{name:"Refresh project versions",exact:true}).click();
  await until(()=>webPackages.locator(`option[value="${webRestored.id}"]`).textContent(),v=>!!v?.includes("v2"),"Web exact version refresh");
  await webPackages.getByRole("combobox").selectOption(webRestored.id); const webExportEvent=web.waitForEvent("download"); await webPackages.getByRole("button",{name:"Download complete project ZIP",exact:true}).click();
  const webExport=await webExportEvent, webZip=path.join(owned,"web-branded-v2.zip"); await webExport.saveAs(webZip); const webBytes=await readFile(webZip);
  assert.equal(JSON.parse(Buffer.from(unzipSync(webBytes)["manifest.json"]).toString()).brand_requirements.source_name,"CopyPaste Destination");
  archives.push({kind:"brand_canvas",purpose:"actual Web v2 export after restored layer editing and PNG render",path:path.relative(delivery,webZip).replaceAll("\\\\","/"),sha256:sha(webBytes),files:Object.keys(unzipSync(webBytes)).length}); await stopRecording();''')
text=text.replace('inputFiles.video','inputFiles.canvas')
replace_section('  await evaluate("document.querySelector(\'#creative-package-workspace [aria-label=', '  const extensionRestored =', '''  await evaluate(`document.querySelector('#creative-package-workspace [aria-label="New project name"]').value='Extension restored brand campaign';`);
  await until(()=>evaluate(`!!document.querySelector('.creative-brand-rebind option[value="${brandChoiceId}"]')`),Boolean,"destination brand options in native Side Panel");
  await evaluate(`{const s=document.querySelector('.creative-brand-rebind select');s.value=${JSON.stringify(brandChoiceId)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate(`!!document.querySelector('[aria-label="fonts:body"]')`),Boolean,"native mapping fields");
  await evaluate(`for(const [name,value] of [['fonts:body','display'],['facts:price','offer'],['logos:mark','identity'],['color:#f6f6f4','#e7eefc']]){const s=document.querySelector('[aria-label="'+name+'"]');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));} [...document.querySelectorAll('.creative-brand-rebind button')].find(b=>b.textContent==='Review brand changes').click();`);
  await until(()=>evaluate(`document.querySelector('.creative-brand-fields article')?.textContent`),v=>typeof v==="string"&&v.includes("198.00"),"native reviewed target price");
  await until(()=>evaluate(`!document.querySelector('.creative-brand-fields').disabled`),Boolean,"brand review complete");
  await evaluate(`document.querySelector('#creative-package-workspace [data-package-preview]>.creative-package-consent input').click();`);
  assert.equal(await evaluate(`[...document.querySelectorAll('#creative-package-workspace button')].find(b=>b.textContent==='Restore a new project').disabled`),true);
  await evaluate(`document.querySelector('.creative-brand-fields .creative-package-consent input').click();document.querySelector('.creative-brand-fields article').scrollIntoView({block:'start'});`);
  screenshots.push(await saveWorkmateScreenshot("extension",`creative-brand-142-${attempt}`,"native-sidepanel-brand-review-en",Buffer.from((await panel.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"),"Actual native right SIDE_PANEL reviews destination fonts, price, Logo and colors before restoring a new copy",delivery));
  await evaluate(`[...document.querySelectorAll('#creative-package-workspace button')].find(b=>b.textContent==='Restore a new project').click()`);
  await until(()=>evaluate("document.querySelector('#creative-package-workspace [data-package-restored]')?.textContent"),v=>typeof v==="string"&&v.includes("Extension restored brand campaign"),"native brand restore");
''')
text=text.replace("name='Extension restored film'","name='Extension restored brand campaign'")
text=text.replace('assert.ok(extensionRestored);','assert.ok(extensionRestored); assert.equal(extensionRestored.body.brand.id,targetBrand.id); assert.equal(extensionRestored.body.layers[0].asset_id,targetLogo.id); assert.match(extensionRestored.body.layers[2].text,/198\\.00/);')
text=text.replace('[[source.id, video.id]]','[[source.id]]').replace('assert.equal(originals.length, 2)','assert.equal(originals.length, 1)')
text=text.replace('Actual frameless Windows package uses OTP/PKCE, restores full video sources and font, edits the script, renders and decodes MP4, then saves a new complete ZIP through a native dialog','Actual frameless Windows package uses OTP/PKCE, reviews and restores destination brand mappings, edits source, renders PNG and saves a complete v2 ZIP through the native dialog')
text=text.replace('Toolbar opens the actual native right SIDE_PANEL, performs real PKCE login, uploads a video ZIP larger than chat-attachment limits in verified parts and restores it without opening a replacement app tab','Toolbar opens the actual native right SIDE_PANEL, uses PKCE and multipart upload, explicitly reviews destination brand facts/fonts/Logo/colors and restores a new copy without a replacement app tab')
text=text.replace('Web OTP login uploads and verifies a source ZIP, restores into a different project, edits layers and downloads an actual PNG','Web OTP login uploads a brand ZIP, explicitly reviews new brand mappings and price, restores into a different project, edits layers and downloads actual PNG plus a complete v2 ZIP')
text=text.replace('full video restoration, script editing, MP4 playback and native ZIP save','brand mapping review, source editing, PNG rendering and native ZIP save')
text=text.replace('multi-part project ZIP upload, manifest review and explicit new-copy restore','multipart brand ZIP upload, reviewed destination facts/fonts/Logo/colors and new-copy restore')
text=text.replace('actual large archive part upload and inspection','actual brand archive multipart upload and inspection')
text=text.replace('source ZIP bytes, Web upload/edit/render','brand ZIP bytes and destination mapping reviews, Web upload/edit/render')
destination=HERE/'qa-creative-brand-142-v1.ts'
with destination.open('x',encoding='utf-8',newline='\n') as file: file.write(text)
qualifier=(HERE/'qualify-creative-packages-ui-140-v6.mjs').read_text(encoding='utf-8').replace('creative-packages-140','creative-brand-142').replace('qa-creative-brand-142-v6.ts','qa-creative-brand-142-v1.ts')
qualifier=qualifier.replace('actual unsigned frameless Windows package and actual Chrome native right SIDE_PANEL perform verified project restores and deterministic PNG/MP4 rendering','actual unsigned frameless Windows package and actual Chrome native right SIDE_PANEL review explicit destination brand mappings, restore new copies and perform deterministic PNG rendering')
with (HERE/'qualify-creative-brand-ui-142-v1.mjs').open('x',encoding='utf-8',newline='\n') as file: file.write(qualifier)
print('Created new brand journey and qualifier; historical scripts remain unchanged.')
