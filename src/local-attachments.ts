import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {realpath,stat,mkdtemp,writeFile,chmod,unlink,rmdir,open} from "node:fs/promises";

export type AttachmentOwner={actorId:string;epoch:string;workspace:string;permission:string|null;revoked:boolean;grantRevision?:number;expiresAt:number};
import type {LocalFileReference} from "./local-file-types.js";
export type {LocalFileReference} from "./local-file-types.js";
type IO={owner:(id:string)=>Promise<AttachmentOwner>;choose:(workspace:string)=>Promise<string[]>;image:()=>Buffer|null|Promise<Buffer|null>};
function identity(owner:AttachmentOwner){return JSON.stringify([owner.actorId,owner.epoch,owner.workspace,owner.permission,owner.grantRevision]);}
function localError(code:string){return Object.assign(new Error(code),{code});}
function granted(owner:AttachmentOwner){if(owner.revoked||!owner.permission||owner.expiresAt<=Date.now())throw localError("LOCAL_PERMISSION_REQUIRED");}
function inside(root:string,file:string){const relative=path.relative(root,file);return !relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative);}
/** Only a native picker or an explicit native clipboard read supplies paths. */
export class LocalAttachments{
 constructor(private io:IO){}
 private async same(id:string,expected:AttachmentOwner){const owner=await this.io.owner(id);granted(owner);if(identity(owner)!==identity(expected))throw localError("LOCAL_ACCOUNT_CHANGED");return owner;}
 async choose(id:string):Promise<LocalFileReference[]>{
  const owner=await this.io.owner(id);granted(owner);const root=await realpath(owner.workspace),paths=await this.io.choose(root);
  await this.same(id,owner);return this.references(id,paths,owner);
 }
 async references(id:string,paths:unknown,expected?:AttachmentOwner):Promise<LocalFileReference[]>{
  const owner=expected??await this.io.owner(id);granted(owner);const root=await realpath(owner.workspace);
  if(!Array.isArray(paths)||paths.length>20||paths.some(p=>typeof p!=="string"||p.length>32767||p.includes("\0")))throw localError("LOCAL_ATTACHMENT_LIMIT");
  const items:LocalFileReference[]=[];
  for(const source of [...new Set(paths)]){const file=await realpath(source);
   if(owner.permission!=="full-access"&&!inside(root,file))throw localError("LOCAL_ATTACHMENT_OUTSIDE_WORKSPACE");
   const info=await stat(file);if(!info.isFile()||info.size<1||info.size>1024**3)throw localError("LOCAL_ATTACHMENT_SIZE");
   items.push({name:path.basename(file),path:file,bytes:info.size});
  }
  await this.same(id,owner);return items;
 }
 async paste(id:string):Promise<LocalFileReference[]>{
  const owner=await this.io.owner(id);granted(owner);if(owner.permission==="read-only")throw localError("LOCAL_ATTACHMENT_WRITE_PERMISSION_REQUIRED");
  const image=await this.io.image();if(!image||image.length<8||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||image.length>4*1024**2)throw localError("LOCAL_CLIPBOARD_IMAGE_REQUIRED");
  const root=await realpath(owner.workspace);await this.same(id,owner);
  const directory=await mkdtemp(path.join(root,".workmate-input-")),file=path.join(directory,"pasted-"+randomUUID()+".png");
  try{await chmod(directory,0o700);await writeFile(file,image,{flag:"wx",mode:0o600});await this.same(id,owner);return [{name:path.basename(file),path:file,bytes:image.length}];}
  catch(error){await unlink(file).catch(()=>{});await rmdir(directory).catch(()=>{});throw error;}
 }
 async preview(id:string,source:unknown){
  if(typeof source!=="string"||!source||source.length>32767||source.includes("\0"))throw localError("LOCAL_RESULT_PATH_INVALID");
  const owner=await this.io.owner(id);granted(owner);const root=await realpath(owner.workspace),file=await realpath(path.resolve(root,source));
  if(owner.permission!=="full-access"&&!inside(root,file))throw localError("LOCAL_ATTACHMENT_OUTSIDE_WORKSPACE");
  const handle=await open(file,"r");let bytes:Buffer;
  try{const before=await handle.stat();if(!before.isFile()||before.size>4*1024**2)throw localError("LOCAL_RESULT_PREVIEW_LIMIT");
   const buffer=Buffer.alloc(Math.min(before.size+1,4*1024**2+1));let size=0;
   while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
   const after=await handle.stat();if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||await realpath(path.resolve(root,source))!==file)throw localError("LOCAL_RESULT_CHANGED");
   bytes=buffer.subarray(0,size);
  }finally{await handle.close();}
  if(await realpath(owner.workspace)!==root)throw localError("LOCAL_ACCOUNT_CHANGED");await this.same(id,owner);
  let mime:string|undefined;
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){if(bytes.readUInt32BE(16)>8192||bytes.readUInt32BE(20)>8192||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>32000000)throw localError("LOCAL_RESULT_PREVIEW_LIMIT");mime="image/png";}
  else if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime="image/jpeg";
  else if(bytes.length>=6&&["GIF87a","GIF89a"].includes(bytes.subarray(0,6).toString("ascii")))mime="image/gif";
  else if(bytes.length>=12&&bytes.subarray(0,4).toString("ascii")==="RIFF"&&bytes.subarray(8,12).toString("ascii")==="WEBP")mime="image/webp";
  const info={name:path.basename(file),path:file,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
  if(mime)return {...info,preview_image:{content_type:mime,base64:bytes.toString("base64")}};
  if(bytes.length>256*1024)throw localError("LOCAL_RESULT_PREVIEW_LIMIT");
  let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw localError("LOCAL_RESULT_PREVIEW_TYPE");}
  if(text.includes("\0"))throw localError("LOCAL_RESULT_PREVIEW_TYPE");return {...info,text};
 }
}
