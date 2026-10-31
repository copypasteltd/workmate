import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "../tests/native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { overviewWorkspace, overviewAdmin } from "../tests/admin-overview-fixture-160-v2.js";
import { historyLogin } from "../tests/admin-history-fixture.js";
const file=process.env.COPYPASTE_FUNCTIONAL_FIXTURE; assert.ok(file);
const isolated=await isolatedTestEnvironment();
let system: Awaited<ReturnType<typeof buildApp>> | undefined, closing=false;
async function close(){if(closing)return;closing=true;try{await system?.app.close();}finally{await isolated.cleanup();}process.exit(0);}
process.on("message",m=>{if((m as any)?.action==="shutdown")void close();}); process.on("SIGTERM",()=>void close());
try{
 system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
 const user=await historyLogin(system), second=await overviewWorkspace(system);
 const permissions=["admin.overview.read","admin.users.read","admin.users.write","admin.billing.read","admin.billing.gift","admin.entitlements.grant","admin.entitlements.read","admin.plans.read","admin.usage.read"];
 await system.db.control.query("UPDATE users SET name=$2 WHERE id=$1",[user.id,"Harbour Recovery Owner"]);
 await system.db.control.query("UPDATE users SET name=$2 WHERE id=$1",[second.owner.id,"Second Studio Owner"]);
 const admin=await overviewAdmin(system,permissions,false);
 await system.app.listen({host:"127.0.0.1",port:4310});
 await writeFile(file,JSON.stringify({user:{id:user.id,email:user.email,name:"Harbour Recovery Owner"},second:{id:second.owner.id,email:second.owner.email,name:"Second Studio Owner"},admin:{email:admin.email,secret:admin.secret.base32},mailbox:system.db.config.DATA_DIR+"/mailbox",database_url:isolated.env.CONTROL_DATABASE_URL}),{flag:"wx"});process.send?.({ready:true});
}catch(e){try{await system?.app.close();}finally{await isolated.cleanup();}throw e;}
