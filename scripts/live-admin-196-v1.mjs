import {readFile} from 'node:fs/promises';
import {context,totp,ok,ADMIN} from './live-client-189-v2.mjs';
import assert from 'node:assert/strict';
export async function authenticateAdmin196(browser){
 const secret=JSON.parse(await readFile('.data/deployment-179/qa-login-context.json','utf8')),c=await context(browser);
 try{
  const page=await c.newPage();await page.goto(ADMIN+'/',{waitUntil:'domcontentloaded'});await page.getByLabel('Administrator email',{exact:true}).fill(secret.admin_email);
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/admin/auth/challenge'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send admin sign-in code',exact:true}).click()]);assert.equal(response.status(),200);const challenge=await response.json();
  const message=await page.evaluate(async({id,auth})=>{const r=await fetch('/ops/mailbox/data/'+id+'.json',{headers:{Authorization:auth},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Protected mailbox status '+r.status);return r.json();},{id:challenge.challenge_id,auth:'Basic '+Buffer.from(secret.operator_username+':'+secret.operator_password).toString('base64')});assert.equal(message.to,secret.admin_email);
  await page.locator('input[name="code"]').fill(message.text.match(/code is (\d{6})/)[1]);await page.locator('input[name="totp"]').fill(totp());await page.getByRole('button',{name:'Verify & open dashboard',exact:true}).click();await page.getByRole('button',{name:'Sign out admin',exact:true}).waitFor();
  const identity=await ok(page,'/v1/admin/me');return {context:c,page,csrf:identity.csrf_token};
 }catch(e){await c.close().catch(()=>{});throw Error(e.name+': '+e.message.split('\n')[0]);}
}
