import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createContext,runInContext} from 'node:vm';
import path from 'node:path';
const {build}=createRequire(path.resolve('../copypaste-desktop/package.json'))('esbuild');

async function fixture(client:string,heldPath:string){
 let release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(r=>entered=r);
 const server=createServer((req,res)=>{
  if(req.url===heldPath){release=()=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({challenge_id:'held-auth',csrf_token:'new-auth-csrf'}));entered();}
  else if(req.method==='GET')res.writeHead(401).end('anonymous bootstrap');
  else res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({csrf_token:'current-csrf'}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const bundle=await build({entryPoints:[`../copypaste-${client}/src/api.ts`],bundle:true,write:false,format:'iife',globalName:'apiModule',platform:'browser',define:{'import.meta.env.VITE_API_BASE':JSON.stringify(url)}});
 const store=new Map<string,string>();
 const scope=createContext({window:new EventTarget(),Event,Headers,Response,FormData,File,Blob,URL,DOMException,crypto,fetch,
  localStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k),get length(){return store.size;},key:(i:number)=>[...store.keys()][i]??null}});
 runInContext(bundle.outputFiles[0].text,scope);
 return {api:scope.apiModule,ready,release:()=>release(),close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
for(const client of ['web','admin']){
 const challenge=client==='admin'?'/v1/admin/auth/challenge':'/v1/auth/challenges';
 const verify=client==='admin'?'/v1/admin/auth/verify':'/v1/auth/sessions';
 const session=client==='admin'?'/v1/admin/me':'/v1/session/context';
 const logout=client==='admin'?'/v1/admin/auth/logout':'/v1/auth/logout';
 for(const authPath of [challenge,verify])test(`${client}: a delayed ${authPath} survives the concurrent anonymous bootstrap 401`,async()=>{
  const f=await fixture(client,authPath);
  try{const request=f.api.post(authPath,{},'retained-attempt');await f.ready;await assert.rejects(f.api.api(session),(e:any)=>e.status===401);f.release();const result=await request;assert.equal(result.challenge_id,'held-auth');assert.equal(f.api.csrfToken,'new-auth-csrf');}finally{await f.close();}
 });
 test(`${client}: explicit sign-out invalidates a pending authentication result`,async()=>{
  const f=await fixture(client,challenge);
  try{const request=f.api.post(challenge);const rejected=assert.rejects(request,(e:any)=>e.code==='SESSION_CHANGED');await f.ready;await f.api.post(logout);f.release();await rejected;assert.equal(f.api.csrfToken,'');}finally{await f.close();}
 });
 test(`${client}: a newer successful sign-in rejects an older challenge result`,async()=>{
  const f=await fixture(client,challenge);
  try{const request=f.api.post(challenge);const rejected=assert.rejects(request,(e:any)=>e.code==='SESSION_CHANGED');await f.ready;await f.api.post(verify);f.release();await rejected;assert.equal(f.api.csrfToken,'current-csrf');}finally{await f.close();}
 });
}
