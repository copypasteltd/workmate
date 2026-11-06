type WorkLocation={kind:"work";tenant:string;project:string;conversation?:string;task?:string};
const id=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
/** IPC accepts resource IDs, never an arbitrary origin or executable URL. */
export function cloudWorkDestination(base:string,input?:unknown){
 const root=new URL(base);if(!["https:","http:"].includes(root.protocol)||root.username||root.password||root.search||root.hash)throw Error("Invalid cloud origin");
 if(input===undefined||input==="geo"||input==="devices")return root.origin+(input==="geo"?"/app/analytics?view=geo":input==="devices"?"/app/devices":"/app");
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid cloud work destination");
 const v=input as WorkLocation;
 if(Object.keys(v).some(k=>!["kind","tenant","project","conversation","task"].includes(k))||v.kind!=="work"||!id.test(v.tenant)||!id.test(v.project)||
  (v.conversation!==undefined&&!id.test(v.conversation))||(v.task!==undefined&&!id.test(v.task))||(!v.conversation&&!v.task))throw Error("Invalid cloud work destination");
 const url=new URL("/app/"+(v.conversation?"conversations/"+v.conversation:"tasks/"+v.task),root.origin);
 url.searchParams.set("workspace",v.tenant);url.searchParams.set("project",v.project);if(v.conversation&&v.task)url.searchParams.set("task",v.task);
 return url.href;
}
