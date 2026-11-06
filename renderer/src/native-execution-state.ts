export type NativeEvent={kind:string;value:any};
export type NativeExecutionRecord={id:string;kind:"command"|"files"|"browser"|"image";status:string;command?:string;output?:string;exit_code?:number|null;files?:{path:string;diff:string}[];path?:string;tool?:string;truncated?:boolean};
const text=(value:unknown,limit=32768)=>typeof value==="string"?value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\0/g,"").slice(0,limit):"";
/** Records are bound by the native controller, never guessed from order. */
export function nativeExecutionRecords(events:NativeEvent[],taskId:string){
 const records=new Map<string,NativeExecutionRecord>();let unbound=0;
 for(const event of events){
  const v=event.value??{};
  if((v.workmate_task_id??v.workflow_task_id)!==taskId){++unbound;continue;}
  const turn=text(v.turnId??v.turn?.id,100),item=v.item,id=turn+":"+text(item?.id??v.itemId??v.call_id,150);
  if(event.kind==="item/commandExecution/outputDelta"){
   const r=records.get(id)??{id,kind:"command",status:"inProgress"};
   if(r.status==="inProgress"){const output=(r.output??"")+text(v.delta);r.output=output.slice(0,32768);r.truncated=r.truncated||output.length>32768;records.set(id,r);}continue;
  }
  if(["item/started","item/completed"].includes(event.kind)&&item){
   const status=text(item.status,64)||(event.kind==="item/completed"?"completed":"inProgress");
   if(item.type==="commandExecution"){
    const output=typeof item.aggregatedOutput==="string"?item.aggregatedOutput:records.get(id)?.output??"";
    records.set(id,{id,kind:"command",status,command:text(item.command,4096),output:text(output),exit_code:Number.isSafeInteger(item.exitCode)?item.exitCode:null,truncated:output.length>32768});
   }else if(item.type==="fileChange"){
    const changes=Array.isArray(item.changes)?item.changes:[];
    records.set(id,{id,kind:"files",status,files:changes.slice(0,100).filter((f:any)=>typeof f.path==="string").map((f:any)=>({path:text(f.path,32767),diff:text(f.diff)})),truncated:changes.length>100||changes.some((f:any)=>typeof f.diff==="string"&&f.diff.length>32768)});
   }else if(item.type==="imageView"&&typeof item.path==="string")records.set(id,{id,kind:"image",status,path:text(item.path,32767)});
  }
  if(event.kind.startsWith("local.browser-tool.")){
   const key="browser:"+turn+":"+(text(v.call_id,150)||"unidentified-"+records.size);
   records.set(key,{id:key,kind:"browser",status:event.kind.split(".").at(-1)??"unknown",tool:text(v.tool,128),output:text(v.code,128)});
  }
 }
 const values=[...records.values()];return {items:values.slice(-100),truncated:values.length>100,unbound};
}
