import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {LocalAttachments,type AttachmentOwner} from '../src/local-attachments.js';
import {nativeExecutionRecords,type NativeEvent} from '../renderer/src/native-execution-state.js';

async function files(work:(directory:string,owner:AttachmentOwner)=>Promise<void>){
 const directory=path.resolve('.data/workspace-196',randomUUID());await mkdir(directory,{recursive:true});
 try{await work(directory,{actorId:'owner',epoch:'epoch',workspace:directory,permission:'read-only',revoked:false,grantRevision:1,expiresAt:Date.now()+60000});}
 finally{assert.equal(path.dirname(directory),path.resolve('.data/workspace-196'));await rm(directory,{recursive:true,force:true});}
}
test('local preview returns exact current UTF-8 or PNG bytes and checksum without upload or command execution',async()=>files(async(directory,owner)=>{
 const local=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>[],image:()=>null});
 const text='本機原稿\r\n100\r\n',file=path.join(directory,'original.txt');await writeFile(file,text);
 const a=await local.preview('session',file);assert.equal(a.text,text);assert.equal(a.sha256,createHash('sha256').update(text).digest('hex'));
 await writeFile(file,'Current changed content');assert.equal((await local.preview('session','original.txt')).text,'Current changed content');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
 await writeFile(path.join(directory,'one.png'),png);const image=await local.preview('session','one.png');assert.deepEqual(Buffer.from(image.preview_image!.base64,'base64'),png);assert.equal(image.preview_image!.content_type,'image/png');
}));
test('preview enforces canonical workspace and current permission, including revocation during the read',async()=>files(async(directory,owner)=>{
 const sub=path.join(directory,'workspace');await mkdir(sub);await writeFile(path.join(directory,'outside.txt'),'private');owner.workspace=sub;
 const local=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>[],image:()=>null});
 await assert.rejects(local.preview('session','../outside.txt'),/OUTSIDE_WORKSPACE/);
 owner.permission='full-access';assert.equal((await local.preview('session','../outside.txt')).text,'private');
 let reads=0;const revoked=new LocalAttachments({owner:async()=>({...owner,revoked:++reads>1}),choose:async()=>[],image:()=>null});
 await assert.rejects(revoked.preview('session','../outside.txt'),/LOCAL_PERMISSION_REQUIRED/);
 reads=0;const changed=new LocalAttachments({owner:async()=>({...owner,epoch:++reads>1?'changed':owner.epoch}),choose:async()=>[],image:()=>null});
 await assert.rejects(changed.preview('session','../outside.txt'),/LOCAL_ACCOUNT_CHANGED/);
 owner.expiresAt=Date.now()-1;await assert.rejects(local.preview('session','../outside.txt'),/LOCAL_PERMISSION_REQUIRED/);
}));
test('preview refuses binary, invalid encoding, oversized files and invalid paths instead of silently decoding them',async()=>files(async(directory,owner)=>{
 const local=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>[],image:()=>null});
 for(const bytes of [Buffer.from([0xc3,0x28]),Buffer.from('binary\0value')]){await writeFile(path.join(directory,'bad'),bytes);await assert.rejects(local.preview('session','bad'),/PREVIEW_TYPE/);}
 await writeFile(path.join(directory,'large'),Buffer.alloc(4*1024**2+1));await assert.rejects(local.preview('session','large'),/PREVIEW_LIMIT/);
 await assert.rejects(local.preview('session','bad\0name'),/PATH_INVALID/);
}));
const event=(kind:string,value:any,task='current'):NativeEvent=>({kind,value:{...value,workmate_task_id:task}});
test('terminal records stay bound to the exact task and merge streamed/completed output without duplicating a command',()=>{
 const events=[event('item/started',{turnId:'turn',item:{id:'one',type:'commandExecution',command:'echo actual'}}),event('item/commandExecution/outputDelta',{turnId:'turn',itemId:'one',delta:'partial'}),event('item/completed',{turnId:'turn',item:{id:'one',type:'commandExecution',command:'echo actual',aggregatedOutput:'actual\u001b[31m\0 result',exitCode:7,status:'completed'}}),event('item/completed',{turnId:'turn',item:{id:'one',type:'commandExecution',command:'foreign',aggregatedOutput:'secret'}},'foreign'),{kind:'item/completed',value:{item:{id:'old',type:'commandExecution',aggregatedOutput:'unbound'}}}];
 const result=nativeExecutionRecords(events,'current');assert.equal(result.items.length,1);assert.equal(result.items[0].output,'actual result');assert.equal(result.items[0].exit_code,7);assert.equal(result.unbound,2);
});
test('native file changes and browser tool outcomes use real event data, preserve failures and bound large output',()=>{
 const events=[event('item/completed',{turnId:'t',item:{id:'f',type:'fileChange',changes:[{path:'report.txt',diff:'actual diff'}]}}),event('local.browser-tool.started',{call_id:'browser',tool:'browser_snapshot'}),event('local.browser-tool.failed',{call_id:'browser',tool:'browser_snapshot',code:'BROWSER_CLOSED'}),event('item/completed',{turnId:'t',item:{id:'c',type:'commandExecution',aggregatedOutput:'x'.repeat(40000),exitCode:1}})];
 const result=nativeExecutionRecords(events,'current');assert.equal(result.items.length,3);assert.deepEqual(result.items[0].files,[{path:'report.txt',diff:'actual diff'}]);assert.equal(result.items[1].status,'failed');assert.equal(result.items[1].output,'BROWSER_CLOSED');assert.equal(result.items[2].output!.length,32768);assert.equal(result.items[2].truncated,true);
 assert.equal(nativeExecutionRecords(events,'another').items.length,0);
});
