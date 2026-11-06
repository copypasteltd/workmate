import assert from 'node:assert/strict';
export const reviewCSV = () => ['date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency',...Array.from({length:13},(_,i)=>[`2026-10-01,Google,Campaign ${i},1000,100,${i?'100.125678':'0'},0,,HKD`,`2026-10-08,Google,Campaign ${i},1000,100,80.123456,0,,HKD`]).flat()].join('\n');
export const reviewImport = name => ({name,csv:reviewCSV(),currency:'HKD',account_id:'review-202-account',attribution_definition:'7d click',conversion_definition:'Purchase'});
export async function openReview(page,name){
 await page.getByLabel('Search dataset history',{exact:true}).fill(name);
 await page.getByRole('button',{name,exact:true}).waitFor();
 await page.getByRole('button',{name:'Create analysis report',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Create analysis report',exact:true});
 await dialog.getByLabel('Business question',{exact:true}).fill('Compare the launch evidence and identify a next test.');
 await dialog.getByLabel('Start date',{exact:true}).fill('2026-10-08');await dialog.getByLabel('End date',{exact:true}).fill('2026-10-08');
 await dialog.getByLabel('Add comparison period',{exact:true}).check();await dialog.getByLabel('Comparison start',{exact:true}).fill('2026-10-01');await dialog.getByLabel('Comparison end',{exact:true}).fill('2026-10-01');await dialog.getByLabel('Breakdown',{exact:true}).selectOption('campaign');
 await dialog.getByRole('button',{name:'Preview report scope',exact:true}).click();
 const review=dialog.getByRole('region',{name:'Complete evidence review',exact:true});await review.waitFor();await review.getByText('Preview · No model charge',{exact:true}).waitFor();
 return {dialog,review};
}
export async function exerciseReview(page,review){
 const pagination=review.getByRole('navigation',{name:'Scope pages',exact:true});
 assert.match(await pagination.innerText(),/13 scopes/);assert.equal(await review.locator('[data-review-scope]').count(),6);
 await pagination.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await review.locator('[data-review-scope]').count(),6);await pagination.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await review.locator('[data-review-scope]').count(),1);
 await review.getByLabel('Search scopes',{exact:true}).fill('Campaign 12');assert.equal(await review.locator('[data-review-scope]').count(),1);
 await review.getByLabel('Search scopes',{exact:true}).fill('');await review.getByLabel('Metric',{exact:true}).selectOption('spend');
 await review.getByRole('button',{name:'Current Spend evidence',exact:true}).first().click();const evidence=page.getByRole('dialog',{name:'Exact value and evidence',exact:true});await evidence.waitFor();assert.ok((await evidence.innerText()).includes('80.12345600'));await evidence.getByRole('button',{name:'Close',exact:true}).click();
 await review.getByLabel('Metric',{exact:true}).selectOption('cpa');await review.getByLabel('Only scopes missing the selected metric',{exact:true}).check();assert.match(await pagination.innerText(),/13 scopes/);await review.getByLabel('Only scopes missing the selected metric',{exact:true}).uncheck();await review.getByLabel('Metric',{exact:true}).selectOption('spend');
 if(await pagination.getByRole('button',{name:'Previous',exact:true}).isEnabled())await pagination.getByRole('button',{name:'Previous',exact:true}).click();
 return {scopes:13,reachable_last_scope:true,exact_value:'80.12345600',unknown_values_preserved:true};
}
export async function reviewOverflow(page,dialog){
 const result=[];
 for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:1100});await page.waitForFunction(w=>innerWidth===w,width);await dialog.evaluate(e=>e.scrollTop=0);const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}))}));assert.ok(dimensions.document<=width,JSON.stringify(dimensions));for(const d of dimensions.dialogs)assert.ok(d.scroll<=d.client,JSON.stringify(dimensions));result.push(dimensions);}
 return result;
}
