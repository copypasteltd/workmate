import {operationKey,completeOperation} from "./operation-key";
const versions=new Map<string,number>();
/** Keep the original version with the retry key. A lost committed reply can be
 * recovered after a same-tab reload even when the conversation has advanced.
 * Storage contains an opaque key and version only, never message content. */
export async function conversationAttempt(account:string,endpoint:string,input:Record<string,unknown>,version:number){
 const key=await operationKey(account,endpoint,input),name="cp_conversation_version_"+key;
 let original=versions.get(name);
 try{const saved=JSON.parse(sessionStorage.getItem(name)??"null");if(Number.isInteger(saved)&&saved>0)original=saved;}catch{}
 original??=version;versions.set(name,original);
 try{sessionStorage.setItem(name,JSON.stringify(original));}catch{}
 return {client_message_id:key,expected_version:original,...input};
}
export async function completeConversationAttempt(account:string,endpoint:string,input:Record<string,unknown>,key:string){
 await completeOperation(account,endpoint,input);
 const name="cp_conversation_version_"+key;versions.delete(name);
 try{sessionStorage.removeItem(name);}catch{}
}
