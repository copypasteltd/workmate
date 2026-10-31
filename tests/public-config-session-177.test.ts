import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
const { build } = createRequire(path.resolve("../copypaste-desktop/package.json"))("esbuild");
for (const client of ["web", "admin", "desktop"]) test(`${client}: a real concurrent unauthenticated session reply does not discard public deployment settings`, async () => {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => entered = r);
  const server = createServer((req,res) => {
    if(req.url === "/v1/public/config") { release=()=>res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({data_mode:"simulated"}));entered(); }
    else res.writeHead(401,{"Content-Type":"application/json"}).end(JSON.stringify({error:{code:"AUTH_REQUIRED",message:"Sign in"}}));
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try {
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const bundle=await build({entryPoints:[client === "desktop" ? "../copypaste-desktop/renderer/src/api.ts" : `../copypaste-${client}/src/api.ts`],bundle:true,write:false,format:"iife",globalName:"apiModule",platform:"browser",define:{"import.meta.env.VITE_API_BASE":JSON.stringify(url)}});
    const store=new Map<string,string>();const scope=createContext({window:new EventTarget(),Event,Headers,Response,FormData,File,Blob,URL,DOMException,crypto,fetch,
      localStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k),get length(){return store.size;},key:(i:number)=>[...store.keys()][i]??null}});
    runInContext(bundle.outputFiles[0].text,scope);const api=scope.apiModule;
    const config=api.api("/v1/public/config");await ready;
    await assert.rejects(api.api(client==="admin"?"/v1/admin/me":"/v1/session/context"),(e:any)=>e.status===401);
    release();assert.equal((await config).data_mode,"simulated");assert.equal(api.csrfToken,"");
  }finally{server.closeAllConnections();await new Promise<void>((r,reject)=>server.close(e=>e?reject(e):r()));}
});
