import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {imageVerificationObservation, validateObservedVerificationPNG} from '../src/image-verification-observation.js';

test('real decoded PNGs produce bounded metadata without storing image contents', () => {
  const image=new PNG({width:1024,height:1024}); image.data.fill(255);
  const bytes=PNG.sync.write(image), observed=validateObservedVerificationPNG(bytes);
  assert.equal(observed.width,1024);assert.equal(observed.height,1024);assert.equal(observed.png,true);
  assert.equal(observed.bytes,bytes.length);assert.match(observed.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(observed).sort(),['bytes','height','png','sha256','width']);
});

test('a complete PNG with an unexpected image size remains unqualified with a specific error', () => {
  const image=new PNG({width:1536,height:1024});image.data.fill(255);
  const bytes=PNG.sync.write(image);
  assert.deepEqual([imageVerificationObservation(bytes).width,imageVerificationObservation(bytes).height],[1536,1024]);
  assert.throws(()=>validateObservedVerificationPNG(bytes),(error:any)=>error.code==='AI_IMAGE_DIMENSIONS_MISMATCH');
});

test('matching headers cannot qualify corrupt PNG pixels or expose arbitrary decoder errors', () => {
  const image=new PNG({width:1024,height:1024});image.data.fill(255);
  const bytes=PNG.sync.write(image);bytes[29]^=1;
  assert.throws(()=>validateObservedVerificationPNG(bytes),(error:any)=>error.code==='AI_IMAGE_PNG_INVALID');
  assert.throws(()=>validateObservedVerificationPNG(Buffer.from('private upstream content')),(error:any)=>error.code==='AI_IMAGE_PNG_INVALID'&&!error.message.includes('private'));
});
