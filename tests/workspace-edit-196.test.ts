import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readWorkspaceSave,prepareWorkspaceSave,keepWorkspaceSave,forgetWorkspaceSave,clearWorkspaceSaves} from '../src/workspace-edit-state.ts';
const rows=new Map<string,string>();
const storage=new Proxy({getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);}}, {ownKeys:()=>[...rows.keys()],getOwnPropertyDescriptor:(_,key)=>typeof key==='string'&&rows.has(key)?{enumerable:true,configurable:true,value:rows.get(key)}:undefined});
Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
const body=()=>({asset_version_id:randomUUID(),expected_task_version:2,expected_delivery_hash:'a'.repeat(64),expected_sha256:'b'.repeat(64),text:'Customer-approved text'});
test('a lost-response save retains exact original key, version/hash tuple and text across a reopen',()=>{
 const source=body(),request=prepareWorkspaceSave(source),scope=randomUUID(),asset=randomUUID();source.text='Different later input';
 assert.equal(keepWorkspaceSave(scope,asset,request),true);const restored=readWorkspaceSave(scope,asset)!;assert.equal(restored.body.text,'Customer-approved text');assert.equal(restored.key,request.key);assert.deepEqual(restored.body,request.body);
 assert.equal(readWorkspaceSave('another-user:'+scope,asset),null);assert.equal(readWorkspaceSave(scope,randomUUID()),null);
 forgetWorkspaceSave(scope,asset);assert.equal(readWorkspaceSave(scope,asset),null);
});
test('sign-out clears all retained customer edits while preserving unrelated session state',()=>{
 rows.set('unrelated','preserved');keepWorkspaceSave(randomUUID(),randomUUID(),prepareWorkspaceSave(body()));clearWorkspaceSaves();assert.deepEqual([...rows.entries()],[['unrelated','preserved']]);
});
test('damaged persistent saves stop recovery, and storage-denied recovery retains its original request in memory',()=>{
 const scope=randomUUID(),asset=randomUUID(),key='cp_workspace_edit_196_'+encodeURIComponent(scope+':'+asset);rows.set(key,JSON.stringify({key:randomUUID(),body:{...body(),expected_task_version:0}}));assert.throws(()=>readWorkspaceSave(scope,asset));forgetWorkspaceSave(scope,asset);
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}}});
 const request=prepareWorkspaceSave(body());assert.equal(keepWorkspaceSave(scope,asset,request),false);assert.deepEqual(readWorkspaceSave(scope,asset),request);clearWorkspaceSaves();assert.equal(readWorkspaceSave(scope,asset),null);
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
});
