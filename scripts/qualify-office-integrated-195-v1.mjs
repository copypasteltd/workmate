import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),{DocumentPreviews}=await import(pathToFileURL(path.join(root,'dist/src/document-preview.js')).href);
const {zipSync,strToU8}=await import('fflate'),{default:PptxGenJS}=await import('pptxgenjs');
const types=body=>'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+body+'</Types>';
const relationship=target=>'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="'+target+'"/></Relationships>';
const zip=entries=>Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,strToU8(v)]))));
const word=zip({'[Content_Types].xml':types('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),'_rels/.rels':relationship('word/document.xml'),'word/document.xml':'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Campaign brief</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Approved 香港 budget</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'});
const excel=zip({'[Content_Types].xml':types('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),'_rels/.rels':relationship('xl/workbook.xml'),'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Campaign budget</t></is></c><c r="B1"><v>195</v></c></row></sheetData></worksheet>'});
const deck=new PptxGenJS();deck.addSlide().addText('Campaign results 香港',{x:1,y:1,w:8,h:2,fontSize:24});
const slides=Buffer.from(await deck.write({outputType:'nodebuffer'}));
const renderer=new DocumentPreviews(),checks=[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 for(const [format,bytes,expect] of [['docx',word,/Campaign brief/],['xlsx',excel,/Campaign budget/],['pptx',slides,/Campaign results/]]){
  const before=digest(bytes),capability=await renderer.capability('application/octet-stream','case.'+format,bytes.length);assert.equal(capability?.state,'ready');
  const page=await renderer.render('qualification-195',format,bytes,1,new AbortController().signal);assert.match(page.text,expect);assert.equal(digest(bytes),before);
  if(format==='docx'){assert.equal(page.page_count,2);const second=await renderer.render('qualification-195',format,bytes,2,new AbortController().signal);assert.match(second.text,/香港/);}
  checks.push({format,page_count:page.page_count,original_unchanged:true,rendered_png_bytes:Buffer.from(page.preview_image.base64,'base64').length});
 }
 const unsafe=zip({'[Content_Types].xml':types(''),'word/vbaProject.bin':'blocked','word/document.xml':'<document/>'});
 await assert.rejects(renderer.render('qualification-195','unsafe',unsafe,1,new AbortController().signal),e=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
 checks.push({boundary:'embedded_executable_rejected',passed:true});
}finally{await renderer.close();}
const work=path.join(root,'.data/document-preview/work');assert.equal((await readdir(work)).filter(x=>x.startsWith('preview-')).length,0);
const result={stage:195,platform:process.platform,uid:process.geteuid?.(),status:'passed',checks,temporary_work_empty:true};
await writeFile(path.join(root,'.data/document-preview/qualification-195-v1.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
