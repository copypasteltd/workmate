import { pathToFileURL } from "node:url";
const {TaskBusinessTools}=await import(pathToFileURL("D:/dev/copypasted/自有agent/dev/copypaste-platform/src/task-business-tools.ts").href);
const original=TaskBusinessTools.prototype.build;
TaskBusinessTools.prototype.build=function(...args){return original.apply(this,args).map(tool=>tool.name!=="browser_preview"?tool:{...tool,run:async(input,id)=>{const value=await tool.run(input,id);console.error("BROWSER_PREVIEW_DIAGNOSTIC "+JSON.stringify({receipt:value.receipt,has_preview:!!value.preview,keys:Object.keys(value)}));return value;}});};
