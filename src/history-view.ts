/** Session storage is only a private navigation hint; every page is read again. */
export type HistoryView={q:string;archived:boolean;pages:string[]};
export function historyView(value:unknown):HistoryView|null{
 if(!value||typeof value!=="object")return null;const v=value as any;
 if(typeof v.q!=="string"||v.q.length>160||typeof v.archived!=="boolean"||!Array.isArray(v.pages)||v.pages.length<1||v.pages.length>512||v.pages[0]!=="")return null;
 if(!v.pages.every((c:unknown,i:number)=>typeof c==="string"&&c.length<=2048&&(i===0||/^[\w-]+\.[\w-]+$/.test(c))))return null;
 return {q:v.q.trim(),archived:v.archived,pages:[...v.pages]};
}
