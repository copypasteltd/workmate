import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as model from "../src/dedicated-cloud-model.js";

const project = "/v1/tenants/:tenant/projects/:project/cloud-computers", node = "/v1/cloud-runtime-nodes/:node", admin = "/v1/admin/cloud-computers";
type Operation = { method: string; path: string; audience: "customer" | "node" | "admin"; body?: string; idempotency?: boolean; permission?: string };
const routes: Operation[] = [
  {method:"GET",path:project+"/plans",audience:"customer"},
  {method:"GET",path:project+"/source-files",audience:"customer"},
  {method:"POST",path:project+"/quotes",audience:"customer",body:"QuoteInput",idempotency:true},
  {method:"DELETE",path:project+"/quotes/:quote",audience:"customer"},
  {method:"POST",path:project+"/sessions",audience:"customer",body:"Confirmation",idempotency:true},
  {method:"GET",path:project+"/sessions",audience:"customer"},
  {method:"GET",path:project+"/sessions/:session",audience:"customer"},
  {method:"DELETE",path:project+"/sessions/:session",audience:"customer"},
  {method:"POST",path:project+"/sessions/:session/stop",audience:"customer",body:"StopInput"},
  {method:"POST",path:project+"/sessions/:session/inputs",audience:"customer",body:"ControlInput",idempotency:true},
  {method:"POST",path:project+"/sessions/:session/agent-tasks",audience:"customer",body:"AgentTaskInput",idempotency:true},
  {method:"GET",path:project+"/sessions/:session/view",audience:"customer"},
  {method:"POST",path:node+"/poll",audience:"node",body:"NodePoll"},
  {method:"POST",path:node+"/acknowledgements",audience:"node",body:"NodeAcknowledgement"},
  {method:"POST",path:node+"/frames",audience:"node",body:"FrameInput"},
  {method:"GET",path:node+"/sessions/:session/files/:version",audience:"node"},
  {method:"GET",path:admin+"/plans",audience:"admin",permission:"admin.cloud_runtime.infrastructure.write"},
  {method:"POST",path:admin+"/plans",audience:"admin",body:"PlanPublication",idempotency:true,permission:"admin.cloud_runtime.infrastructure.write"},
  {method:"GET",path:admin+"/nodes",audience:"admin",permission:"admin.cloud_runtime.infrastructure.write"},
  {method:"POST",path:admin+"/nodes",audience:"admin",body:"NodeRegistration",idempotency:true,permission:"admin.cloud_runtime.infrastructure.write"},
  {method:"POST",path:admin+"/nodes/:node/rotate-credential",audience:"admin",body:"ReasonedCAS",idempotency:true,permission:"admin.cloud_runtime.infrastructure.write"},
  {method:"GET",path:admin+"/sessions",audience:"admin",permission:"admin.cloud_runtime.sessions.read"},
  {method:"POST",path:admin+"/sessions/:session/stop",audience:"admin",body:"ReasonedCAS",idempotency:true,permission:"admin.cloud_runtime.sessions.stop"},
  {method:"POST",path:admin+"/sessions/:session/reconciliation",audience:"admin",body:"ReasonedCAS",idempotency:true,permission:"admin.cloud_runtime.sessions.reconcile"},
];
const inputs = {
  QuoteInput:model.dedicatedQuoteInput,Confirmation:model.dedicatedConfirmation,ControlInput:model.dedicatedControlInput,
  AgentTaskInput:model.dedicatedAgentTaskInput,NodePoll:model.dedicatedNodePoll,NodeAcknowledgement:model.dedicatedNodeAcknowledgement,
  FrameInput:model.dedicatedFrameInput,NodeRegistration:model.dedicatedNodeRegistration,StopInput:z.object({}).strict(),
  PlanPublication:z.object({plan:model.dedicatedPlanInput,enabled:z.boolean(),expected_version:z.number().int().nonnegative()}).strict(),
  ReasonedCAS:z.object({expected_version:z.number().int().positive(),reason:z.string().trim().min(8).max(500)}).strict(),
};
const schemas=Object.fromEntries(Object.entries(inputs).map(([name,value])=>[name,z.toJSONSchema(value)]));
const paths: Record<string,any>={};
for(const route of routes){
  const parameters:any[]=[...route.path.matchAll(/:([a-z]+)/g)].map(m=>({name:m[1],in:"path",required:true,schema:{type:"string",format:"uuid"}}));
  if(route.idempotency)parameters.push({name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",format:"uuid"}});
  if(route.audience!=="node"&&route.method!=="GET")parameters.push({name:"X-CSRF-Token",in:"header",required:true,schema:{type:"string"}});
  if(route.audience==="node"&&route.method==="GET")parameters.push({name:"generation",in:"query",required:true,schema:{type:"integer",minimum:1}},{name:"instance_id",in:"query",required:true,schema:{type:"string",format:"uuid"}});
  const path=route.path.replace(/:([a-z]+)/g,"{$1}");
  (paths[path]??={})[route.method.toLowerCase()]={operationId:route.audience+"_"+route.method.toLowerCase()+"_"+route.path.replace(/[^a-zA-Z0-9]+/g,"_"),
    tags:["Dedicated computer / "+route.audience],parameters,security:[{[route.audience==="node"?"NodeBearer":route.audience==="admin"?"AdminSession":"CustomerSession"]:[]}],
    ...(route.permission?{"x-current-mfa-required":true,"x-permission":route.permission}:{}),
    ...(route.body?{requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/"+route.body}}}}}:{}),
    responses:{"200":{description:"Current authorized operation result. Private responses must not be cached."},"400":{description:"Invalid bounded input"},"401":{description:"Current authentication required"},"403":{description:"Scope, consent, MFA or authority unavailable"},"404":{description:"Private resource unavailable"},"409":{description:"Stale version, ended lease, changed receipt or unavailable capacity"},"429":{description:"Rate limit"}},
  };
}
const baseline=await readFile("contracts/implemented-routes.json","utf8");
await writeFile("contracts/dedicated-cloud-route-additions.json",JSON.stringify({schema:"copypaste-dedicated-cloud-routes-v1",baseline_lf_sha256:createHash("sha256").update(baseline.replaceAll("\r\n","\n")).digest("hex"),routes:routes.map(({method,path})=>({method,path})),conditional_routes:[]},null,2)+"\n");
await writeFile("contracts/dedicated-cloud-openapi.json",JSON.stringify({openapi:"3.1.0",info:{title:"CopyPaste Workmate dedicated cloud computer API",version:"1.0.0",description:"Optional operator-preprovisioned physical computer, exact private files, separate resource and AI task consent. No automatic renewal, provisioning, local Desktop delegation or administrator content access. Node receipts require independently verified cleanup and known usage. Synthetic protocol qualification does not qualify a physical Linux deployment."},paths,components:{schemas,securitySchemes:{CustomerSession:{type:"apiKey",in:"cookie",name:"cp_session"},AdminSession:{type:"apiKey",in:"cookie",name:"cp_admin_session"},NodeBearer:{type:"http",scheme:"bearer"}}}},null,2)+"\n");
console.log(JSON.stringify({routes:routes.length,schemas:Object.keys(schemas).length}));
