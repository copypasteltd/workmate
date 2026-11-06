import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionMilliseconds,executionSeconds} from '../src/execution-timing.js';
test('recorded execution time preserves genuine zero and milliseconds',()=>{assert.equal(executionMilliseconds(0),0);assert.equal(executionMilliseconds(1250),1250);assert.equal(executionSeconds(1250),'1.3s');});
test('missing and invalid measurements never become NaN, infinity or invented zero',()=>{for(const value of [undefined,null,'1500',NaN,Infinity,-Infinity,-1,1.5,{},true]){assert.equal(executionMilliseconds(value),null);assert.equal(executionSeconds(value),null);}});
test('large valid recorded measurements stay finite in the compact execution label',()=>{assert.equal(executionSeconds(3600000),'3600.0s');assert.equal(executionSeconds(12),'0.0s');});
