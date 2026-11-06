import {readFile,writeFile} from 'node:fs/promises';
import {context,WEB,ADMIN,ok} from './live-client-189-v2.mjs';
import assert from 'node:assert/strict';
/** Browser-native sign-in/mail reads; never print request headers on errors. */
export async function authenticateOwner196(browser){
 const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8')),email='agent-test-20261102@workmate.local';
 const c=await context(browser);let mailbox;
 try{
  const page=await c.newPage();await page.goto(WEB+'/login',{waitUntil:'domcontentloaded'});await page.getByLabel('Work email',{exact:true}).fill(email);
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/auth/challenges'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send sign-in code',exact:true}).click()]);assert.equal(response.status(),202);const challenge=await response.json();
  mailbox=await c.newPage();await mailbox.goto(ADMIN+'/',{waitUntil:'domcontentloaded'});const message=await mailbox.evaluate(async({id,auth})=>{const r=await fetch('/ops/mailbox/data/'+id+'.json',{headers:{Authorization:auth},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Protected mailbox status '+r.status);return r.json();},{id:challenge.challenge_id,auth:'Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64')});assert.equal(message.to,email);await mailbox.close();mailbox=null;
  await page.getByLabel('6-digit sign-in code',{exact:true}).fill(message.text.match(/code is (\d{6})/)[1]);const [session]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/auth/sessions'&&r.request().method()==='POST'),page.getByRole('button',{name:'Verify & continue',exact:true}).click()]);assert.equal(session.status(),201);
  const identity=await ok(page,'/v1/session/context');await writeFile('.data/acceptance-189/realowner-state.private.json',JSON.stringify(await c.storageState()),{mode:0o600});return {context:c,page,identity,csrf:identity.csrf_token};
 }catch(e){await mailbox?.close().catch(()=>{});await c.close().catch(()=>{});throw Error(e.name+': '+e.message.split('\n')[0]);}
}
