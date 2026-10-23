// Run from dev/copypaste-platform with --import tsx. The original OpenAPI and
// its previously published runtime projection retain their independent bytes.
import { z } from "../../dev/copypaste-platform/node_modules/zod/index.js";
import { brandDefinition, brandBinding } from "../../dev/copypaste-platform/src/brand-production.ts";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const uuid = { type:"string",format:"uuid" }, positive = {type:"integer",minimum:1}, timestamp={type:"string",format:"date-time"}, sha={type:"string",pattern:"^[a-f0-9]{64}$"};
const obj = (properties,required=Object.keys(properties)) => ({type:"object",properties,required,additionalProperties:false});
const ref = name => ({$ref:"#/components/schemas/"+name});
const jsonSchema = schema => {const value=z.toJSONSchema(schema,{io:"input"});delete value.$schema;return value;};
const schemas = {
 BrandDefinition:jsonSchema(brandDefinition),BrandBinding:jsonSchema(brandBinding),
 BrandPublish:obj({expected_version:positive,definition:ref("BrandDefinition")}),
 BrandPublication:{type:"object",required:["id","tenant_id","project_id","name","body","version","created_at","content_state","moderation_version"],properties:{id:uuid,tenant_id:uuid,project_id:uuid,name:{type:"string"},body:ref("BrandDefinition"),version:positive,created_at:timestamp,content_state:{const:"active"},moderation_version:positive},additionalProperties:true},
 BrandVersion:obj({version:positive,name:{type:"string"},body:{type:"object",description:"Exact stored guidance. Legacy versions retain their original shape; no rights are invented."},sha256:sha,created_at:timestamp,created_by:{anyOf:[uuid,{type:"null"}]}}),
 BrandCheckInput:obj({channel:{type:"string",maxLength:60},locale:{type:"string",maxLength:60},text:{type:"string",maxLength:5000},font_key:{type:"string",maxLength:60},fact_key:{type:"string",maxLength:60}},["channel","locale","text"]),
 BrandCheck:obj({id:uuid,version:positive,sha256:sha,text:{type:"string"},glyphs:{const:"covered"},rights_status:{const:"customer_declared"}}),
 BrandVersionList:obj({items:{type:"array",maxItems:100,items:ref("BrandVersion")}}),
 Problem:obj({error:obj({code:{type:"string"},message:{type:"string"},details:{},request_id:{type:"string"}},["code","message","request_id"])})
};
schemas.BrandDefinition.description="Immutable production guidance. Server checks unique keys, supported locales/currencies, matching amount/currency, promotion expiry, ordered validity, font channel subsets, active shared file versions and actual font bytes. Font rights are customer declarations. Existing legacy POST /brand is preserved separately.";
const paths={},base="/v1/tenants/{tenant}/projects/{project}/brand";
function operation(suffix,method,response,body,status=200){
 const route=base+suffix,parameters=[...route.matchAll(/\{([^}]+)\}/g)].map(([,name])=>({name,in:"path",required:true,schema:name==="version"?positive:uuid}));
 if(body&&suffix!=="/{id}/versions/{version}/check")parameters.push({name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:16,maxLength:128}});
 const item={operationId:({"/definitions":"createBrandDefinition","/{id}":"publishBrandVersion","/{id}/versions":"listBrandVersions","/{id}/versions/{version}/check":"checkBrandProduction"})[suffix],parameters,security:[{userSession:[]},{nativeBearer:[]}],responses:{[status]:{description:"Success",content:{"application/json":{schema:ref(response)}}},default:{description:"Scoped authentication, version, source, glyph or validity error",content:{"application/json":{schema:ref("Problem")}}}}};
 if(body)item.requestBody={required:true,content:{"application/json":{schema:ref(body)}}};(paths[route]??={})[method]=item;
}
operation("/definitions","post","BrandPublication","BrandDefinition",201);operation("/{id}","put","BrandPublication","BrandPublish");operation("/{id}/versions","get","BrandVersionList");operation("/{id}/versions/{version}/check","post","BrandCheck","BrandCheckInput");
const contract={openapi:"3.1.0",info:{title:"CopyPaste versioned brand production addendum",version:"1.0.0",description:"Additive running operations. Check is a read-only preflight; production rechecks at render and before saving. Historical output availability is not tied to current promotion expiry. Not a replacement for the original full product contract."},paths,components:{securitySchemes:{userSession:{type:"apiKey",in:"cookie",name:"cp_session",description:"Browser writes require the current CSRF token and an allowed origin."},nativeBearer:{type:"http",scheme:"bearer",description:"An authorized native client token; never an Admin session."}},schemas}};
const bytes=JSON.stringify(contract,null,2)+"\n";
for(const f of ["docs/contracts/brand-production-openapi.json","dev/copypaste-platform/contracts/brand-production-openapi.json"])await writeFile(path.join(root,f),bytes);
const file=path.join(root,"dev/copypaste-platform/contracts/implemented-routes.json"),inventory=JSON.parse(await readFile(file,"utf8"));
const additions=[];for(const [route,methods]of Object.entries(paths))for(const method of Object.keys(methods))additions.push({method:method.toUpperCase(),path:route.replace(/\{([^}]+)\}/g,":$1")});
for(const route of additions)if(!inventory.routes.some(r=>r.method===route.method&&r.path===route.path))inventory.routes.push(route);
inventory.routes.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));inventory.generated_at=new Date().toISOString();inventory.conditional_routes=[{method:"POST",path:"/v1/tenants/:tenant/demo-credit",when:"DEMO_MODE=true"}];inventory.additive_inventory_validation="brand-production.test.ts compares the complete array with the actual running Fastify registration";
await writeFile(file,JSON.stringify(inventory,null,2)+"\n");console.log(JSON.stringify({operations:additions.length,actual_route_inventory:inventory.routes.length}));
