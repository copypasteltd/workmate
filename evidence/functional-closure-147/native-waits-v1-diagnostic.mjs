import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const platform=path.resolve('../copypaste-platform');
process.loadEnvFile(path.join(platform,'.env'));
const {Client}=createRequire(path.join(platform,'package.json'))('pg');
const result=[];
for(const port of process.argv.slice(2)){
  assert.match(port,/^\d{4,5}$/);
  const url=new URL(process.env.OWNER_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));url.port=port;url.pathname='/postgres';
  const client=new Client({connectionString:url.href,connectionTimeoutMillis:4000,query_timeout:5000});
  try{
    await client.connect();
    const dir=(await client.query('SHOW data_directory')).rows[0].data_directory;
    assert.match(dir.replaceAll('\\','/'),/\.data\/native-qa\/[a-f0-9-]{36}$/);
    const rows=(await client.query("SELECT pid,backend_type,state,wait_event_type,wait_event,clock_timestamp()-query_start AS elapsed,CASE WHEN query ~ '^CHECKPOINT' THEN 'CHECKPOINT' WHEN query ~ '^CREATE DATABASE' THEN 'CREATE DATABASE' WHEN query ~ '^DROP DATABASE' THEN 'DROP DATABASE' WHEN query ~ '^UPDATE' THEN 'UPDATE' WHEN query ~ '^SELECT' THEN 'SELECT' ELSE 'other' END AS operation FROM pg_stat_activity WHERE pid<>pg_backend_pid() ORDER BY pid")).rows;
    result.push({port:Number(port),owned_native_uuid:dir.replaceAll('\\','/').split('/').at(-1),fsync:(await client.query('SHOW fsync')).rows[0].fsync,activity:rows});
  }catch(error){result.push({port:Number(port),error:String(error)});}
  finally{await client.end().catch(()=>{});}
}
const report={at:new Date().toISOString(),scope:'Read-only wait diagnosis of explicitly supplied disposable native QA ports; no queries or settings changed',result};
await writeFile('evidence/functional-closure-147/native-waits-v1.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
