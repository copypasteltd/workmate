from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];dev=root/'dev'
source=(dev/'copypaste-web/src/execution-timing.ts').read_bytes();(dev/'copypaste-desktop/renderer/src/execution-timing.ts').write_bytes(source)
client_test='''import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionMilliseconds,executionSeconds} from '../src/execution-timing.js';
test('recorded execution time preserves genuine zero and milliseconds',()=>{assert.equal(executionMilliseconds(0),0);assert.equal(executionMilliseconds(1250),1250);assert.equal(executionSeconds(1250),'1.3s');});
test('missing and invalid measurements never become NaN, infinity or invented zero',()=>{for(const value of [undefined,null,'1500',NaN,Infinity,-Infinity,-1,1.5,{},true]){assert.equal(executionMilliseconds(value),null);assert.equal(executionSeconds(value),null);}});
test('large valid recorded measurements stay finite in the compact execution label',()=>{assert.equal(executionSeconds(3600000),'3600.0s');assert.equal(executionSeconds(12),'0.0s');});
'''
(dev/'copypaste-web/tests/execution-timing-197-v1.test.ts').write_text(client_test,encoding='utf8')
(dev/'copypaste-desktop/tests/execution-timing-197-v1.test.ts').write_text(client_test.replace('../src/execution-timing.js','../renderer/src/execution-timing.js'),encoding='utf8')
backend_test='''import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptElapsedMs} from '../src/execution-timing.js';
test('actual host elapsed time takes precedence including genuine zero',()=>{assert.equal(receiptElapsedMs({host:{elapsed_ms:0}}),0);assert.equal(receiptElapsedMs({host:{elapsed_ms:2300},started_at:'invalid'}),2300);});
test('Linux receipts use their actual canonical run timestamps when host timing is absent',()=>{assert.equal(receiptElapsedMs({host:{},started_at:'2026-11-06T00:00:00.000Z',finished_at:'2026-11-06T00:00:01.500Z'}),1500);});
test('missing, reversed, invalid or noncanonical timestamps remain unknown',()=>{for(const receipt of [{},{host:{elapsed_ms:NaN}},{host:{elapsed_ms:-1}},{started_at:'5',finished_at:'6'},{started_at:'2026-11-06T00:00:00.000Z',finished_at:'2026-11-05T00:00:00.000Z'},{started_at:'2026-02-30T00:00:00.000Z',finished_at:'2026-03-03T00:00:00.000Z'}])assert.equal(receiptElapsedMs(receipt),null);});
'''
(dev/'copypaste-platform/tests/execution-timing-197-v1.test.ts').write_text(backend_test,encoding='utf8')
p=dev/'copypaste-platform/tests/workspace-execution-196-v1.test.ts';test=p.read_text(encoding='utf8').replace("assert.equal(a.items.length,2);", "assert.equal(a.items.length,2);assert.ok(a.items.every((r:any)=>typeof r.elapsed_ms==='number'&&Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>=0));")
new=p.with_name('workspace-execution-196-v2.test.ts');assert not new.exists();new.write_text(test,encoding='utf8')
for component,version in [('platform','0.5.5'),('web','0.5.4'),('desktop','0.7.8')]:
 for name in ['package.json','package-lock.json']:
  p=dev/('copypaste-'+component)/name;value=json.loads(p.read_text(encoding='utf8'));value['version']=version
  if name=='package-lock.json':value['packages']['']['version']=version
  p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
p=root/'docs/requirements/197-connection-and-native-review-round.md';p.write_text(p.read_text(encoding='utf8')+'\n整批联调修正 197-07：Linux 执行耗时优先读取真实宿主测量，缺失时使用原执行回执的规范开始／结束时间；无法确认则为 null。Web 与 Desktop 不把缺失、负数、无穷或非法值显示成 NaN 或零。同步检查矩阵导出的同类耗时显示。此修正完整编码后再统一复验，既有失败和发布包保持。\n',encoding='utf8')
scripts=dev/'copypaste-delivery/scripts';p=scripts/'verify-integrated-round-197-v1.mjs';text=p.read_text(encoding='utf8').replace('integrated-197-v1','integrated-197-v2').replace('desktop-unstarted-settlement-197|','execution-timing-197|desktop-unstarted-settlement-197|')
(scripts/'verify-integrated-round-197-v2.mjs').write_text(text,encoding='utf8')
print('Completed the whole execution-timing correction batch. No tests run by this script.')
