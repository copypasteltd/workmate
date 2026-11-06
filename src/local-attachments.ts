import path from "node:path";
import {randomUUID} from "node:crypto";
import {realpath,stat,mkdtemp,writeFile,chmod,unlink,rmdir} from "node:fs/promises";

export type AttachmentOwner={actorId:string;epoch:string;workspace:string;permission:string|null;revoked:boolean;grantRevision?:number;expiresAt:number};
export type LocalFileReference={name:string;path:string;bytes:number};
type IO={owner:(id:string)=>Promise<AttachmentOwner>;choose:(workspace:string)=>Promise<string[]>;image:()=>Buffer|null|Promise<Buffer|null>};
function identity(owner:AttachmentOwner){return JSON.stringify([owner.actorId,owner.epoch,owner.workspace,owner.permission,owner.grantRevision]);}
function granted(owner:AttachmentOwner){if(owner.revoked||!owner.permission||owner.expiresAt<=Date.now())throw new Error("LOCAL_PERMISSION_REQUIRED");}
function inside(root:string,file:string){const relative=path.relative(root,file);return !relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative);}
/** Only a native picker or an explicit native clipboard read supplies paths. */
export class LocalAttachments{
 constructor(private io:IO){}
 private async same(id:string,expected:AttachmentOwner){const owner=await this.io.owner(id);granted(owner);if(identity(owner)!==identity(expected))throw new Error("LOCAL_ACCOUNT_CHANGED");return owner;}
 async choose(id:string):Promise<LocalFileReference[]>{
  const owner=await this.io.owner(id);granted(owner);const root=await realpath(owner.workspace),paths=await this.io.choose(root);
  await this.same(id,owner);return this.references(id,paths,owner);
 }
 async references(id:string,paths:unknown,expected?:AttachmentOwner):Promise<LocalFileReference[]>{
  const owner=expected??await this.io.owner(id);granted(owner);const root=await realpath(owner.workspace);
  if(!Array.isArray(paths)||paths.length>20||paths.some(p=>typeof p!=="string"||p.length>32767||p.includes("\0")))throw new Error("LOCAL_ATTACHMENT_LIMIT");
  const items:LocalFileReference[]=[];
  for(const source of [...new Set(paths)]){const file=await realpath(source);
   if(owner.permission!=="full-access"&&!inside(root,file))throw new Error("LOCAL_ATTACHMENT_OUTSIDE_WORKSPACE");
   const info=await stat(file);if(!info.isFile()||info.size<1||info.size>1024**3)throw new Error("LOCAL_ATTACHMENT_SIZE");
   items.push({name:path.basename(file),path:file,bytes:info.size});
  }
  await this.same(id,owner);return items;
 }
 async paste(id:string):Promise<LocalFileReference[]>{
  const owner=await this.io.owner(id);granted(owner);if(owner.permission==="read-only")throw new Error("LOCAL_ATTACHMENT_WRITE_PERMISSION_REQUIRED");
  const image=await this.io.image();if(!image||image.length<8||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||image.length>4*1024**2)throw new Error("LOCAL_CLIPBOARD_IMAGE_REQUIRED");
  const root=await realpath(owner.workspace);await this.same(id,owner);
  const directory=await mkdtemp(path.join(root,".workmate-input-")),file=path.join(directory,"pasted-"+randomUUID()+".png");
  try{await chmod(directory,0o700);await writeFile(file,image,{flag:"wx",mode:0o600});await this.same(id,owner);return [{name:path.basename(file),path:file,bytes:image.length}];}
  catch(error){await unlink(file).catch(()=>{});await rmdir(directory).catch(()=>{});throw error;}
 }
}
