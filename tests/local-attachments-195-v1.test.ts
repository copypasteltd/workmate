import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {LocalAttachments,type AttachmentOwner} from "../src/local-attachments.js";

test("native file references respect current local scope and recheck after the picker",async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"workmate-attachments-"));
 try{
  const workspace=path.join(directory,"inside.txt"),outside=path.join(directory,"outside.txt");await writeFile(workspace,"inside");await writeFile(outside,"outside");
  let owner:AttachmentOwner={actorId:"actor",epoch:"epoch",workspace:directory,permission:"read-only",revoked:false,grantRevision:1,expiresAt:Date.now()+60000};
  let selected=[workspace];
  const attachments=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>selected,image:()=>null});
  assert.equal((await attachments.choose("session"))[0].path,workspace);
  owner={...owner,workspace:path.dirname(directory)};assert.equal((await attachments.references("session",[outside]))[0].name,"outside.txt");
  owner={...owner,workspace:path.join(directory,"sub")};await import("node:fs/promises").then(fs=>fs.mkdir(owner.workspace));
  await assert.rejects(attachments.references("session",[outside]),/LOCAL_ATTACHMENT_OUTSIDE_WORKSPACE/);
  owner={...owner,permission:"full-access"};assert.equal((await attachments.references("session",[outside])).length,1);
  const revoked=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>{owner={...owner,revoked:true};return selected;},image:()=>null});
  await assert.rejects(revoked.choose("session"),/LOCAL_PERMISSION_REQUIRED/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test("clipboard copies require write permission, keep valid PNG bytes local and reject changed identity",async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"workmate-clipboard-"));
 try{
  let owner:AttachmentOwner={actorId:"actor",epoch:"epoch",workspace:directory,permission:"read-only",revoked:false,grantRevision:1,expiresAt:Date.now()+60000};
  const bytes=Buffer.from("89504e470d0a1a0a00000000","hex");
  const attachments=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>[],image:()=>bytes});
  await assert.rejects(attachments.paste("session"),/WRITE_PERMISSION/);
  owner.permission="workspace-write";const [file]=await attachments.paste("session");
  assert.deepEqual(await readFile(file.path),bytes);assert.ok(path.relative(directory,file.path).startsWith(".workmate-input-"));
  const changed=new LocalAttachments({owner:async()=>({...owner}),choose:async()=>[],image:()=>{owner={...owner,epoch:"other"};return bytes;}});
  await assert.rejects(changed.paste("session"),/LOCAL_ACCOUNT_CHANGED/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
