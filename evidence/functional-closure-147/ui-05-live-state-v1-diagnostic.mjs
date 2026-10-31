import {createRequire} from 'node:module';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const platform=path.resolve('../copypaste-platform');process.loadEnvFile(path.join(platform,'.env'));
const {Client}=createRequire(path.join(platform,'package.json'))('pg');
const url=new URL(process.env.OWNER_DATABASE_URL);url.port='11769';url.pathname='/postgres';
const client=new Client({connectionString:url.href,connectionTimeoutMillis:4000,query_timeout:5000});await client.connect();
assert.match((await client.query('SHOW data_directory')).rows[0].data_directory.replaceAll('\\','/'),/\.data\/native-qa\/879fbea4-c9ee-4b0b-85bd-d3111cdd4fe0$/);
const databases=(await client.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres','copypaste')")).rows;await client.end();
const results=[];
for(const {datname} of databases){url.pathname='/'+datname;const c=new Client({connectionString:url.href,connectionTimeoutMillis:4000,query_timeout:5000});try{await c.connect();if(!(await c.query("SELECT to_regclass('public.workflow_runs') t")).rows[0].t)continue;results.push({database:datname,workflows:(await c.query('SELECT state,cursor,(active_task IS NOT NULL) child_created FROM workflow_runs')).rows,tasks:(await c.query('SELECT role_key,status,attempt,execution_location FROM tasks ORDER BY created_at')).rows});}finally{await c.end();}}
const report={at:new Date().toISOString(),scope:'Read-only states in the explicitly verified disposable UI05 database; no mutation or customer data',results};await writeFile('evidence/functional-closure-147/ui-05-live-state-v1.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
