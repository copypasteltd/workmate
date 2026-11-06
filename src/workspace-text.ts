import {Problem} from "./lib.js";

export const workspaceTextLimit=256*1024;
export const workspaceTextMime=(mime:string)=>mime.startsWith("text/")||["application/json","application/xml","application/javascript","application/x-yaml"].includes(mime);
export function workspaceDocument(bytes:Buffer){
 if(bytes.length>workspaceTextLimit)throw new Problem(413,"WORKSPACE_TEXT_TOO_LARGE","Download this file or request a complete-file revision");
 let text:string;
 try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new Problem(415,"WORKSPACE_TEXT_ENCODING","Only valid UTF-8 text can be edited here");}
 if(text.includes("\0"))throw new Problem(415,"WORKSPACE_TEXT_ENCODING","Binary content cannot be edited as text");
 const bom=bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf;
 const crlf=(text.match(/\r\n/g)??[]).length,lf=(text.match(/(?<!\r)\n/g)??[]).length,loneCR=/\r(?!\n)/.test(text);
 const newline=loneCR||crlf>0&&lf>0?"mixed":crlf?"crlf":"lf";
 return {text:text.replace(/\r\n/g,"\n"),bom,newline,editable:newline!=="mixed"};
}
export function editedWorkspaceBytes(original:ReturnType<typeof workspaceDocument>,text:string){
 if(!original.editable)throw new Problem(409,"WORKSPACE_MIXED_NEWLINES","This file has mixed line endings. Download it or request a revision to preserve its format");
 if(text.includes("\0")||/\r(?!\n)/.test(text))throw new Problem(400,"WORKSPACE_TEXT_ENCODING","Use UTF-8 text with consistent line endings");
 const normalized=text.replace(/\r\n/g,"\n"),bytes=Buffer.from((original.bom?"\ufeff":"")+(original.newline==="crlf"?normalized.replace(/\n/g,"\r\n"):normalized),"utf8");
 // Reject lone surrogates rather than silently replacing them during encoding.
 if(new TextDecoder("utf-8",{ignoreBOM:true}).decode(Buffer.from(text,"utf8"))!==text)throw new Problem(400,"WORKSPACE_TEXT_ENCODING","Invalid Unicode text");
 if(bytes.length>workspaceTextLimit)throw new Problem(413,"WORKSPACE_TEXT_TOO_LARGE","Text edits are limited to256 KiB");
 return bytes;
}
export type WorkspaceDiffLine={kind:"context"|"add"|"remove"|"skip";text?:string;old_line?:number;new_line?:number;count?:number};
/** Exact bounded LCS; expensive comparisons return an explicit summary. */
export function workspaceDiff(before:string,after:string){
 const a=before.split("\n"),b=after.split("\n");
 if(a.length>20000||b.length>20000)return {state:"summary_only" as const,reason:"line_limit"};
 let prefix=0,suffix=0;
 while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])++prefix;
 while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])++suffix;
 const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix),width=right.length+1,cells=(left.length+1)*width;
 if(cells>1000000)return {state:"summary_only" as const,reason:"comparison_limit"};
 const table=new Uint32Array(cells);
 for(let i=left.length-1;i>=0;--i)for(let j=right.length-1;j>=0;--j)table[i*width+j]=left[i]===right[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
 const all:WorkspaceDiffLine[]=[];let old=1,next=1,added=0,removed=0;
 const context=(text:string)=>all.push({kind:"context",text,old_line:old++,new_line:next++});
 for(let i=0;i<prefix;++i)context(a[i]);
 let i=0,j=0;
 while(i<left.length||j<right.length){
  if(i<left.length&&j<right.length&&left[i]===right[j]){context(left[i]);++i;++j;}
  else if(j<right.length&&(i===left.length||table[i*width+j+1]>table[(i+1)*width+j])){all.push({kind:"add",text:right[j++],new_line:next++});++added;}
  else{all.push({kind:"remove",text:left[i++],old_line:old++});++removed;}
 }
 for(let k=a.length-suffix;k<a.length;++k)context(a[k]);
 const lines:WorkspaceDiffLine[]=[];
 for(let cursor=0;cursor<all.length;){
  if(all[cursor].kind!=="context"){lines.push(all[cursor++]);continue;}
  let end=cursor;while(end<all.length&&all[end].kind==="context")++end;
  const first=cursor===0,last=end===all.length,keepStart=first?0:3,keepEnd=last?0:3;
  if(end-cursor<=keepStart+keepEnd+3)lines.push(...all.slice(cursor,end));
  else{lines.push(...all.slice(cursor,cursor+keepStart));lines.push({kind:"skip",count:end-cursor-keepStart-keepEnd,old_line:all[cursor+keepStart].old_line,new_line:all[cursor+keepStart].new_line});lines.push(...all.slice(end-keepEnd,end));}
  cursor=end;
 }
 return {state:"ready" as const,added,removed,lines};
}
