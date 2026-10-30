import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
// Rendering consumes supplied bytes and bundled resources only. No annotation,
// XFA, document script or remote font/image request is part of this viewer.
globalThis.fetch=async()=>{throw new Error('Document preview network access is disabled');};
const require=createRequire(import.meta.url), resources=path.dirname(require.resolve('pdfjs-dist/package.json')).replaceAll('\\','/')+'/';
let loading;
try {
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  loading=pdfjs.getDocument({data:new Uint8Array(workerData.bytes),verbosity:0,
    cMapUrl:resources+'cmaps/',standardFontDataUrl:resources+'standard_fonts/',
    wasmUrl:resources+'wasm/',iccUrl:resources+'iccs/',
    useWorkerFetch:false,useSystemFonts:false,isEvalSupported:false,enableXfa:false,
    maxImageSize:4_000_000,canvasMaxAreaInBytes:8_000_000,stopAtErrors:true});
  const document=await loading.promise;
  if(document.numPages>400)throw Object.assign(new Error('Too many pages'),{code:'DOCUMENT_PREVIEW_PAGE_LIMIT'});
  if(workerData.page>document.numPages)throw Object.assign(new Error('Page not found'),{code:'DOCUMENT_PREVIEW_PAGE_RANGE'});
  const page=await document.getPage(workerData.page), base=page.getViewport({scale:1});
  if(!Number.isFinite(base.width*base.height)||base.width<1||base.height<1)throw new Error('Invalid page size');
  const scale=Math.min(1.6,1200/base.width,1600/base.height,Math.sqrt(1_920_000/(base.width*base.height)));
  const viewport=page.getViewport({scale}),width=Math.max(1,Math.ceil(viewport.width)),height=Math.max(1,Math.ceil(viewport.height));
  const canvas=createCanvas(width,height),context=canvas.getContext('2d');
  await page.render({canvas,canvasContext:context,viewport,background:'rgb(255,255,255)',annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;
  let picture=canvas.toBuffer('image/png'),contentType='image/png';
  if(picture.length>2_000_000){picture=canvas.encodeSync('jpeg',85);contentType='image/jpeg';}
  if(picture.length>2_000_000)throw new Error('Rendered page is too large');
  const text=await page.getTextContent();let plain='';for(const item of text.items){if('str'in item)plain+=(plain?' ':'')+item.str;if(plain.length>20000)break;}
  parentPort.postMessage({ok:true,page:workerData.page,page_count:document.numPages,width,height,
    preview_image:{content_type:contentType,base64:picture.toString('base64')},text:plain.slice(0,20000)});
  page.cleanup();await document.cleanup();
}catch(error){parentPort.postMessage({ok:false,code:error?.code??(error?.name==='PasswordException'?'DOCUMENT_PREVIEW_ENCRYPTED':'DOCUMENT_PREVIEW_INVALID')});}
finally{if(loading)await loading.destroy().catch(()=>{});parentPort.close();}
