// The packaged Chromium renderer provides the native cryptographic API.
const crypto=globalThis.crypto;
const prefix="cp_workspace_edit_196_",fallback=new Map<string,string>();
export type WorkspaceSave={key:string;body:{asset_version_id:string;expected_task_version:number;expected_delivery_hash:string;expected_sha256:string;text:string}};
const name=(scope:string,asset:string)=>prefix+encodeURIComponent(scope+":"+asset);
export function readWorkspaceSave(scope:string,asset:string):WorkspaceSave|null{
 const k=name(scope,asset);let raw=fallback.get(k)??null;
 try{raw=sessionStorage.getItem(k)??raw;}catch{}
 if(!raw)return null;
 const r=JSON.parse(raw),b=r?.body;
 if(!r||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.key)||!b||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(b.asset_version_id)||!Number.isSafeInteger(b.expected_task_version)||b.expected_task_version<1||! /^[a-f0-9]{64}$/.test(b.expected_delivery_hash)||! /^[a-f0-9]{64}$/.test(b.expected_sha256)||typeof b.text!=="string"||b.text.length>262144)throw Error("WORKSPACE_EDIT_DRAFT_DAMAGED");
 return r;
}
export function prepareWorkspaceSave(body:WorkspaceSave["body"]):WorkspaceSave{return {key:crypto.randomUUID(),body:structuredClone(body)};}
export function keepWorkspaceSave(scope:string,asset:string,request:WorkspaceSave){const k=name(scope,asset),value=JSON.stringify(request);fallback.set(k,value);try{sessionStorage.setItem(k,value);return true;}catch{return false;}}
export function forgetWorkspaceSave(scope:string,asset:string){const k=name(scope,asset);fallback.delete(k);try{sessionStorage.removeItem(k);}catch{}}
export function clearWorkspaceSaves(){fallback.clear();try{for(const k of Object.keys(sessionStorage))if(k.startsWith(prefix))sessionStorage.removeItem(k);}catch{}}
