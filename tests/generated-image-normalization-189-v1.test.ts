import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {crc32} from 'node:zlib';
import {normalizeGeneratedImagePNG} from '../src/generated-image-normalization.js';
import {validateVerificationPNG} from '../src/png-validation.js';

function image(side:number) {
  const png=new PNG({width:side,height:side});
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const i=(y*side+x)*4;png.data[i]=x<side/2?255:0;png.data[i+1]=y<side/2?255:0;png.data[i+2]=80;png.data[i+3]=255;
  }
  return png;
}

test('an actual-sized 1254-square PNG becomes decoded 1024-square pixels while its source identity remains available',()=>{
  const source=PNG.sync.write(image(1254)), result=normalizeGeneratedImagePNG(source), decoded=PNG.sync.read(result.bytes);
  assert.equal(result.normalized,true);assert.equal(result.source.width,1254);assert.equal(result.source.height,1254);
  assert.equal(result.output.width,1024);assert.equal(result.output.height,1024);assert.notEqual(result.output.sha256,result.source.sha256);
  assert.deepEqual([decoded.width,decoded.height],[1024,1024]);assert.doesNotThrow(()=>validateVerificationPNG(result.bytes));
  const pixel=(x:number,y:number)=>[...decoded.data.subarray((y*1024+x)*4,(y*1024+x)*4+4)];
  assert.deepEqual(pixel(128,128),[255,255,80,255]);assert.deepEqual(pixel(896,896),[0,0,80,255]);
});

test('an already conforming PNG keeps its exact original bytes and content hash',()=>{
  const source=PNG.sync.write(image(1024)), result=normalizeGeneratedImagePNG(source);
  assert.equal(result.normalized,false);assert.equal(result.bytes,source);assert.equal(result.source.sha256,result.output.sha256);
});

test('resampling uses premultiplied alpha so invisible source colours do not create a coloured fringe',()=>{
  const png=new PNG({width:1254,height:1254});
  for(let i=0;i<png.data.length;i+=4){png.data[i]=255;png.data[i+3]=0;}
  for(let y=0;y<1254;y++)for(let x=0;x<627;x++){const i=(y*1254+x)*4;png.data[i]=0;png.data[i+2]=255;png.data[i+3]=255;}
  const decoded=PNG.sync.read(normalizeGeneratedImagePNG(PNG.sync.write(png)).bytes);
  for(let x=510;x<514;x++){const i=(512*1024+x)*4;assert.equal(decoded.data[i],0);if(decoded.data[i+3])assert.equal(decoded.data[i+2],255);}
});

test('normalization never accepts malformed PNGs, changed aspect ratios, tiny images or oversized IHDR claims',()=>{
  const valid=PNG.sync.write(image(1254)), bad=Buffer.from(valid);bad[29]^=1;
  const oversized=Buffer.from(valid);oversized.writeUInt32BE(2049,16);oversized.writeUInt32BE(2049,20);oversized.writeUInt32BE(crc32(oversized.subarray(12,29)),29);
  const portrait=new PNG({width:1024,height:1254});portrait.data.fill(255);
  for(const bytes of [bad,valid.subarray(0,-8),oversized,PNG.sync.write(portrait),PNG.sync.write(image(512)),Buffer.from('not an image')])
    assert.throws(()=>normalizeGeneratedImagePNG(bytes),(error:any)=>['AI_IMAGE_PNG_INVALID','AI_IMAGE_DIMENSIONS_MISMATCH'].includes(error.code));
});
