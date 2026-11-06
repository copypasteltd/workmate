import assert from 'node:assert/strict';
/** Geometry from the actual built page, not a selector/source assertion. */
export async function assertReviewLayout(page,dialog,review){
 const r=await dialog.evaluate((element)=>{
  const review=element.querySelector('.evidence-review'),labels=[...element.querySelectorAll('.review-track>span')].map(e=>{const box=e.getBoundingClientRect(),style=getComputedStyle(e);return{text:e.textContent,width:box.width,height:box.height,line_height:style.lineHeight,white_space:style.whiteSpace};});
  return{dialog_width:element.getBoundingClientRect().width,viewport:innerWidth,document_width:document.documentElement.scrollWidth,client:element.clientWidth,scroll:element.scrollWidth,review_width:review?.getBoundingClientRect().width,labels};
 });
 assert.ok(r.document_width<=r.viewport&&r.scroll<=r.client,JSON.stringify(r));
 if(r.viewport>=1200)assert.ok(r.dialog_width>=960,JSON.stringify(r));
 assert.ok(r.labels.some(l=>l.text==='Comparison'));
 for(const l of r.labels){assert.equal(l.white_space,'nowrap');assert.ok(l.width>0);}
 return r;
}
