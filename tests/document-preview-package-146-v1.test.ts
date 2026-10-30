import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {campaignWorkbook} from './document-fixtures-146-v2.js';
import {inspectOfficePreview} from '../src/document-preview-package.js';
test('decoded Office XML cannot hide network formulas behind entities or another encoding',async()=>{
  for(const formula of['WEBSER&#86;ICE(&quot;https://example.invalid/data&quot;)','&#68;DE(&quot;soffice&quot;,&quot;remote&quot;,&quot;A1&quot;)']){
    const files=unzipSync(campaignWorkbook());files['xl/worksheets/sheet1.xml']=strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>${formula}</f><v>0</v></c></row></sheetData></worksheet>`);
    await assert.rejects(inspectOfficePreview(Buffer.from(zipSync(files))),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
  }
  const files=unzipSync(campaignWorkbook());files['xl/worksheets/sheet1.xml']=Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16"?><worksheet/>','utf16le');
  await assert.rejects(inspectOfficePreview(Buffer.from(zipSync(files))),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
  const encoded=unzipSync(campaignWorkbook());encoded['xl/worksheets/sheet1.xml']=strToU8('<?xml version="1.0" encoding="UTF-7"?><worksheet/>');
  await assert.rejects(inspectOfficePreview(Buffer.from(zipSync(encoded))),(e:any)=>e.code==='DOCUMENT_PREVIEW_OFFICE_UNSAFE');
});
