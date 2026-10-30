import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import { zipSync,strToU8 } from "fflate";
import { DocumentPreviews } from "../src/document-preview.js";
import { hash } from "../src/lib.js";
import { inspectOfficePreview } from "../src/document-preview-package.js";
export function wordFile(external=false){
  const types=`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rel=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const document=`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CopyPaste campaign brief</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Approved multilingual budget 香港</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
  const members:any={'[Content_Types].xml':strToU8(types),'_rels/.rels':strToU8(rel),'word/document.xml':strToU8(document)};
  if(external)members['word/_rels/document.xml.rels']=strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/private.png" TargetMode="External"/></Relationships>`);
  return Buffer.from(zipSync(members));
}
test("real PDF pages retain independent content and reject unavailable pages",{timeout:60000},async()=>{
  const renderer=new DocumentPreviews();try{
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
    for(const text of ['First approved campaign','Second measured result']){const p=pdf.addPage([400,500]);p.drawRectangle({x:0,y:0,width:400,height:500,color:rgb(.96,.96,1)});p.drawText(text,{x:30,y:400,font,size:20});}
    const bytes=Buffer.from(await pdf.save()),signal=new AbortController().signal;
    const one=await renderer.render('pdf-reader','pdf-source',bytes,1,signal),two=await renderer.render('pdf-reader','pdf-source',bytes,2,signal);
    assert.equal(one.page_count,2);assert.match(one.text,/First approved campaign/);assert.match(two.text,/Second measured result/);
    assert.notEqual(hash(Buffer.from(one.preview_image.base64,'base64')),hash(Buffer.from(two.preview_image.base64,'base64')));
    assert.ok(one.width>400&&one.width<=1200&&one.height<=1600);
    await assert.rejects(renderer.render('pdf-reader','pdf-source',bytes,3,signal),(e:any)=>e.code==='DOCUMENT_PREVIEW_PAGE_RANGE');
  }finally{await renderer.close();}
});
test("real native Word conversion preserves its explicit page boundary and original bytes",{timeout:120000},async()=>{
  const renderer=new DocumentPreviews();try{
    const bytes=wordFile(),digest=hash(bytes),signal=new AbortController().signal;
    assert.equal(await inspectOfficePreview(bytes),'docx');assert.equal((await renderer.capability('application/octet-stream','campaign.docx',bytes.length))?.state,'ready');
    const one=await renderer.render('office-reader','word-source',bytes,1,signal),two=await renderer.render('office-reader','word-source',bytes,2,signal);
    assert.equal(one.page_count,2);assert.match(one.text,/CopyPaste campaign brief/);assert.match(two.text,/Approved multilingual budget/);assert.match(two.text,/香港/);assert.equal(hash(bytes),digest);
  }finally{await renderer.close();}
});
test("external Office data and embedded executables stop before conversion",async()=>{
  await assert.rejects(inspectOfficePreview(wordFile(true)),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
  const archive=zipSync({'[Content_Types].xml':strToU8('<Types/>'),'_rels/.rels':strToU8('<Relationships/>'),'word/document.xml':strToU8('<document/>'),'word/vbaProject.bin':strToU8('blocked')});
  await assert.rejects(inspectOfficePreview(Buffer.from(archive)),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
});
