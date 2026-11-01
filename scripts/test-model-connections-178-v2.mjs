import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const repo = path.resolve("../copypaste-platform"), require = createRequire(path.join(repo,"package.json")), pg = require("pg");
const id = randomUUID(), folder = path.resolve(".data/model-connections-178", id);
await mkdir(folder, { recursive: true }); const log = await open(path.join(folder,"native-tests.log"), "wx");
const listener = createServer(); await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
const port = listener.address().port; await new Promise(resolve=>listener.close(resolve));
const env = { ...process.env, COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + id, NODE_ENV: "test" };
for (const [name,role] of [["OWNER_DATABASE_URL","cp_owner"],["DATABASE_URL","cp_app"],["CONTROL_DATABASE_URL","cp_control"],["QUEUE_DATABASE_URL","cp_queue"]])
  env[name] = `postgresql://${role}:${randomBytes(24).toString("hex")}@127.0.0.1:${port}/copypaste`;
let child, result=1;
try {
  child=spawn(process.execPath,["scripts/native-db-launch.mjs"],{cwd:repo,env,windowsHide:true,stdio:["ignore",log.fd,log.fd,"ipc"]});
  let ready=false; const deadline=Date.now()+120000;
  while (Date.now()<deadline && child.exitCode===null) {
    const db=new pg.Client({connectionString:env.CONTROL_DATABASE_URL,connectionTimeoutMillis:500});
    try { await db.connect(); await db.query("SELECT 1 FROM schema_migrations WHERE version=157");
      const r=await db.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version=157"); if(r.rows[0].n===1){ready=true;break;} }
    catch {} finally { await db.end().catch(()=>{}); }
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  if(!ready) throw new Error("Owned native test database did not become ready; log retained");
  console.log(JSON.stringify({stage:178,native_database:"isolated",ready:true,log:folder}));
  const tests=spawn(process.execPath,["scripts/run-tests-owned.mjs","tests/model-connections-178-v2.test.ts"],{cwd:repo,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  for(const stream of [tests.stdout,tests.stderr]) stream.on("data",b=>{void log.write(b);process.stdout.write(b);});
  result=await new Promise(resolve=>tests.once("exit",code=>resolve(code??1)));
} finally {
  if(child?.connected && child.exitCode===null) { child.send({action:"shutdown"}); await new Promise(resolve=>child.once("exit",resolve)); }
  await log.close();
}
process.exitCode=result;
