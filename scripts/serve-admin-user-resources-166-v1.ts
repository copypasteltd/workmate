import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "../tests/native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { overviewAdmin } from "../tests/admin-overview-fixture-160-v2.js";
import { userResourceFixture,userResourcePermissions } from "../tests/admin-user-resources-fixture-166-v1.js";
const file=process.env.COPYPASTE_FUNCTIONAL_FIXTURE;assert.ok(file);
const isolated=await isolatedTestEnvironment();let system:Awaited<ReturnType<typeof buildApp>>|undefined,closing=false;
async function close(){if(closing)return;closing=true;try{await system?.app.close();}finally{await isolated.cleanup();}process.exit(0);}
process.on("message",m=>{if((m as any)?.action==="shutdown")void close();});process.on("SIGTERM",()=>void close());
try{
 system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
 const f=await userResourceFixture(system);
 const admin=await overviewAdmin(system,["admin.overview.read",...userResourcePermissions,"admin.content.body.read"],false);
 await system.app.listen({host:"127.0.0.1",port:4310});
 await writeFile(file,JSON.stringify({user:{id:f.first.owner.id,email:f.first.owner.email,name:"Harbour Creator"},second:{id:f.second.id,email:f.second.email,name:"Studio Collaborator"},tasks:f.tasks,asset_id:f.asset.id,other_asset_id:f.secondAsset.id,brand_id:f.brand,legacy_brand_id:f.legacyBrand,admin:{email:admin.email,secret:admin.secret.base32},mailbox:system.db.config.DATA_DIR+"/mailbox"}),{flag:"wx"});process.send?.({ready:true});
}catch(e){try{await system?.app.close();}finally{await isolated.cleanup();}throw e;}
