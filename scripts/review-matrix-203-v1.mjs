import assert from 'node:assert/strict';
/** Actual React preference controls configure each view; no data/model replies change. */
export async function reviewMatrix(page,app){
 const original=app?await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()):page.viewportSize(),rows=[];
 async function theme(wanted){for(let i=0;i<4;i++){if(await page.evaluate(()=>localStorage.getItem('cp_theme'))===wanted)break;await page.getByTitle('Theme: light / dark / system',{exact:true}).evaluate(e=>e.click());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}await page.waitForFunction(t=>document.documentElement.dataset.theme===t,wanted);}
 async function locale(wanted){if(await page.evaluate(()=>document.documentElement.lang)!==wanted)await page.getByTitle(wanted==='en'?'Switch to English':'切換至繁體中文',{exact:true}).evaluate(e=>e.click());await page.waitForFunction(l=>document.documentElement.lang===l,wanted);}
 try{
  for(const l of ['en','zh-Hant-HK']){await locale(l);for(const t of ['light','dark']){await theme(t);for(const width of app?[768,1320]:[375,768,1440]){
   if(app)await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,1000),width);else await page.setViewportSize({width,height:1100});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const row=await page.locator('[role=dialog]').last().evaluate(e=>({locale:document.documentElement.lang,theme:document.documentElement.dataset.theme,width:innerWidth,document_width:document.documentElement.scrollWidth,client:e.clientWidth,scroll:e.scrollWidth,tracks:[...e.querySelectorAll('.review-track>span')].map(l=>({text:l.textContent,white_space:getComputedStyle(l).whiteSpace,width:l.getBoundingClientRect().width}))}));
   assert.ok(row.document_width<=row.width&&row.scroll<=row.client,JSON.stringify(row));assert.ok(row.tracks.length>0);assert.ok(row.tracks.every(l=>l.white_space==='nowrap'&&l.width>0));rows.push({...row,requested_width:width});
  }}}
 }finally{await locale('en');await theme('light');if(app)await app.evaluate(({BrowserWindow},b)=>BrowserWindow.getAllWindows()[0].setBounds(b),original);else await page.setViewportSize(original);}
 return {scope:'Actual layouts after configuring existing preference controls; not keyboard interaction with background controls or a physical OS zoom claim',views:rows};
}
