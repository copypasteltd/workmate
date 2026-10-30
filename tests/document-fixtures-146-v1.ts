import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import {zipSync,strToU8} from "fflate";
import PptxGenJS from "pptxgenjs";
export async function campaignPDF(){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(const [i,text]of ['Campaign brief — approved'.replace('—','-'),'Measured campaign result'].entries()){
    const page=pdf.addPage([595,842]);page.drawRectangle({x:0,y:0,width:595,height:842,color:rgb(.965,.965,.955)});
    page.drawRectangle({x:0,y:750,width:595,height:92,color:rgb(.08,.09,.1)});
    page.drawText('copypaste / workmate',{x:42,y:790,size:20,font,color:rgb(1,1,1)});
    page.drawText(text,{x:42,y:680,size:25,font,color:rgb(.08,.09,.1)});
    page.drawText(i?'Budget HKD 12,800 | conversions 128':'Marketing team | Hong Kong | October 2026',{x:42,y:630,size:15,font});
    page.drawText('Original source. Fixed version. Clear decisions.',{x:42,y:570,size:16,font});
  }
  return Buffer.from(await pdf.save());
}
export function campaignWorkbook(){
  const members:Record<string,Uint8Array>={};const put=(name:string,xml:string)=>members[name]=strToU8(xml);
  put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+[1,2].map(n=>`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>');
  put('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  put('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Campaign budget" sheetId="1" r:id="rId1"/><sheet name="Campaign results" sheetId="2" r:id="rId2"/></sheets></workbook>');
  put('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[1,2].map(n=>`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')+'</Relationships>');
  for(const n of[1,2])put(`xl/worksheets/sheet${n}.xml`,`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${n===1?'Approved campaign budget':'Measured campaign result'}</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Hong Kong</t></is></c><c r="B2"><v>${n===1?12800:128}</v></c></row></sheetData><pageSetup paperSize="9" orientation="portrait"/></worksheet>`);
  return Buffer.from(zipSync(members));
}
export async function campaignSlides(){
  const slides=new PptxGenJS();slides.author='CopyPaste';slides.subject='Synthetic acceptance fixture';
  for(const title of ['Approved campaign brief','Measured campaign result']){const slide=slides.addSlide();slide.background={color:'F6F6F4'};slide.addText(title,{x:.7,y:1.2,w:8,h:1,fontSize:30,color:'15171A'});slide.addText('Hong Kong marketing team',{x:.7,y:3,w:8,h:.7,fontSize:18});}
  return Buffer.from(await slides.write({outputType:'nodebuffer'}) as Buffer);
}
