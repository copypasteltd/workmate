import type {FastifyInstance} from "fastify";
import {statfs} from "node:fs/promises";
import type {Database} from "./db.js";
import type {Catalog} from "./catalog.js";
import {requireAdmin} from "./auth.js";
import {capabilityAuthority} from "./capability-releases.js";
import {DocumentPreviews} from "./document-preview.js";
import {cloudProgramAvailable} from "./cloud-program-executor.js";
import {cloudBrowserAvailable} from "./cloud-browser-runtime.js";

export function registerOperationalReadiness(app:FastifyInstance,db:Database,catalog:Catalog){
 app.get("/v1/admin/operational-readiness",{preHandler:requireAdmin(db)},async req=>{
  const c=db.config;
  const capabilities=await db.tx(async tx=>{await capabilityAuthority(tx,req.principal,"admin.catalog.read");
   return [...(await catalog.currentCapabilities(tx)).values()].map(v=>({profile_key:v.profile_key,model:[v.body.model,v.body.model_id,v.body.model_alias].find(value=>typeof value==="string")??null,
    ready:!!v.ready&&!v.revoked,revoked:!!v.revoked,version_id:v.id,independent_connection:!!v.body.model_connection_id}));
  },undefined,true);
  const office=new DocumentPreviews();let officeReady=false;
  try{officeReady=!!(await office.capability("application/vnd.openxmlformats-officedocument.wordprocessingml.document","readiness.docx",1))?.available;}finally{await office.close();}
  const [programs,browser]=await Promise.all([cloudProgramAvailable(),cloudBrowserAvailable()]);
  const checks:Array<{key:string;state:string;configured:boolean;message:string;configure_url:string;fields?:string[]}>=[];
  const add=(key:string,configured:boolean,message:string,configure_url:string,fields?:string[],state?:string)=>checks.push({key,state:state??(configured?"ready":"setup_required"),configured,message,configure_url,...(fields?{fields}:{})});
  for(const [key,fields] of [["text",["gpt","text","reasoning"]],["image",["image"]],["video",["video"]],["speech",["speech"]],["transcription",["transcription"]]] as const){
   const matched=capabilities.filter(v=>key==="text"?catalog.defaultAssistant.model_bindings.some((b:any)=>b.required&&b.profile_key===v.profile_key):fields.some(f=>v.profile_key.includes(f)));
   add(key,matched.some(v=>v.ready),"A published, verified model capability is required. Configure the upstream address and API key on that model.","/catalog?view=capabilities");
  }
  add("google",!!(c.GOOGLE_CLIENT_ID&&c.GOOGLE_CLIENT_SECRET),"OAuth application configured; each customer must still authorize its own accounts.","/connections",["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]);
  add("google_ads",!!(c.GOOGLE_CLIENT_ID&&c.GOOGLE_CLIENT_SECRET&&c.GOOGLE_ADS_DEVELOPER_TOKEN),"Google Ads also requires its developer token and an authorized customer account.","/connections",["GOOGLE_ADS_DEVELOPER_TOKEN"]);
  add("meta",!!(c.META_APP_ID&&c.META_APP_SECRET),"Meta application configured; permissions and customer account consent remain required.","/connections",["META_APP_ID","META_APP_SECRET"]);
  add("mail",!!c.SMTP_URL,"Test inbox remains enabled when requested. Real external delivery requires SMTP.","/policy",["SMTP_URL","MAIL_FROM","DEV_MAILBOX"],c.DEV_MAILBOX?"test_only":c.SMTP_URL?"ready":"setup_required");
  add("cloud_programs",programs,"Native cloud programs execute under the API service's restricted delegated identity.","/execution");
  add("cloud_browser",browser,"Cloud browser availability is checked in the API service identity.","/execution");
  add("office_preview",officeReady,"Private native Office conversion; PDF preview is available independently.","/readiness");
  add("production_profile",c.NODE_ENV==="production"&&!c.DEV_MAILBOX&&!c.DEMO_MODE,"A retained test mailbox is a testing profile, even with real AI. Production qualification requires separate acceptance.","/readiness",["NODE_ENV","DEV_MAILBOX","SMTP_URL"],c.NODE_ENV==="production"&&!c.DEV_MAILBOX&&!c.DEMO_MODE?"ready":"test_only");
  let storage:{kind:string;free_bytes?:number;state:string}={kind:c.S3_BUCKET?"s3":"native_filesystem",state:"configured"};
  if(!c.S3_BUCKET)try{const s=await statfs(c.DATA_DIR);storage={...storage,free_bytes:s.bavail*s.bsize,state:s.bavail*s.bsize<1024**3?"low_space":"ready"};}catch{storage.state="unavailable";}
  return {checked_at:new Date().toISOString(),data_mode:c.DEMO_MODE?"simulated":"configured_services",kernel:"codex",codex_version:c.CODEX_VERSION,
   checks,capabilities,storage,configuration_file:"/root/cfg/workmate/app.env",acceptance_policy:"Configured or ready does not certify professional quality, continuous availability or backup recovery."};
 });
}
