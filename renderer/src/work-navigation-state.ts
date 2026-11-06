/** Browser history is a navigation hint, never identity or resource authority. */
export const workId=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type DirectoryView={q:string;archived:boolean;status:string;location:string;mode:string;pages:string[]};
export const emptyDirectory=():DirectoryView=>({q:"",archived:false,status:"",location:"",mode:"",pages:[""]});
export function directoryView(value:unknown):DirectoryView|null{
 if(!value||typeof value!=="object")return null;const v=value as Record<string,unknown>;
 if(typeof v.q!=="string"||v.q.length>160||typeof v.archived!=="boolean"||typeof v.status!=="string"||typeof v.location!=="string"||typeof v.mode!=="string")return null;
 if(!["","queued","running","needs_input","awaiting_approval","paused","reconciling","succeeded","failed","cancelled"].includes(v.status)||!["","cloud","desktop"].includes(v.location)||!["","ask","plan","execute"].includes(v.mode))return null;
 if(!Array.isArray(v.pages)||v.pages.length<1||v.pages.length>512||v.pages[0]!==""||!v.pages.every((c,i)=>typeof c==="string"&&c.length<=2048&&(i===0||/^[\w-]+\.[\w-]+$/.test(c)||workId.test(c))))return null;
 return {q:v.q,archived:v.archived,status:v.status,location:v.location,mode:v.mode,pages:[...v.pages] as string[]};
}
export function readDirectory(state:unknown,scope:string,kind:string):DirectoryView{
 const saved=(state as any)?.workNavigation198?.[kind];return saved?.scope===scope?directoryView(saved.value)??emptyDirectory():emptyDirectory();
}
export function updateNavigation(state:unknown,scope:string,kind:string,value:unknown){
 const source=state&&typeof state==="object"&&!Array.isArray(state)?state as Record<string,unknown>:{};
 const prior=source.workNavigation198&&typeof source.workNavigation198==="object"&&!Array.isArray(source.workNavigation198)?source.workNavigation198 as Record<string,unknown>:{};
 return {...source,workNavigation198:{...prior,[kind]:{scope,value}}};
}
export function scopedWorkPath(path:string,tenant:string,project:string){
 if(!workId.test(tenant)||!workId.test(project))throw Error("Invalid work location");
 const target=new URL(path,"https://workmate.invalid");
 if(target.origin!=="https://workmate.invalid"||!/^\/app(?:\/(?:tasks|conversations|files|notifications)(?:\/[a-f\d-]{36})?)?$/.test(target.pathname)||target.hash)throw Error("Unsupported work location");
 target.searchParams.set("workspace",tenant);target.searchParams.set("project",project);return target.pathname+target.search;
}
export function routeScope(path:string,search:string):{tenant:string;project:string}|null|"invalid"{
 if(!/^\/app(?:\/(?:tasks|conversations|files|notifications)(?:\/[a-f\d-]{36})?)?$/.test(path))return null;
 const q=new URLSearchParams(search);if(!q.has("workspace")&&!q.has("project"))return null;
 const tenant=q.get("workspace")??"",project=q.get("project")??"";
 return q.getAll("workspace").length===1&&q.getAll("project").length===1&&workId.test(tenant)&&workId.test(project)?{tenant,project}:"invalid";
}
export function pageForward(view:DirectoryView,cursor:string):DirectoryView{
 // Bound browser-history memory; the current page remains accessible and Refresh starts over.
 if(view.pages.length>=512)throw Error("Refresh the list before continuing / 請重新整理清單後繼續");
 const next={...view,pages:[...view.pages,cursor]};if(!directoryView(next))throw Error("Invalid task page");return next;
}
