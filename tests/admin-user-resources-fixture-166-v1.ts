import assert from "node:assert/strict";
import { historyLogin, historyOk, type System } from "./admin-history-fixture.js";
import { overviewWorkspace, overviewTask } from "./admin-overview-fixture-160-v2.js";
import { saveAsset } from "../src/storage.js";

export const userResourcePermissions = ["admin.users.read", "admin.execution.read", "admin.content.read"];
export async function userResourceFixture(s: System) {
  const first = await overviewWorkspace(s), outside = await overviewWorkspace(s), second = await historyLogin(s);
  second.tenant = first.tenant;
  for (const [user, space] of [[second.id, first], [first.owner.id, outside]] as const) {
    await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')", [space.tenant,user]);
    await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [space.tenant,space.project,user]);
  }
  await s.db.control.query("UPDATE users SET name='Harbour Creator' WHERE id=$1",[first.owner.id]);
  await s.db.control.query("UPDATE users SET name='Studio Collaborator' WHERE id=$1",[second.id]);
  const tasks = [await overviewTask(s, first), await overviewTask(s, first), await overviewTask(s, {...outside,owner:{...first.owner,tenant:outside.tenant}})];
  const other = await overviewTask(s, {...first,owner:second});
  for (let i=0;i<tasks.length;i++) await s.db.control.query("UPDATE tasks SET title=$2,created_at='2026-10-01T00:00:00Z' WHERE id=$1",[tasks[i].id,"Harbour selected task "+(i+1)]);
  await s.db.control.query("UPDATE tasks SET title='Studio collaborator task' WHERE id=$1",[other.id]);
  async function file(user:string,name:string) {
    return s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:first.tenant,project:first.project,user,name,mime:"text/plain",bytes:Buffer.from("Private synthetic file body for "+name)}),first.tenant,true,user);
  }
  const asset = await file(first.owner.id,"Harbour creator brief.txt"), secondAsset=await file(second.id,"Studio collaborator brief.txt");
  const base=`/v1/tenants/${first.tenant}/projects/${first.project}`;
  const brand=await historyOk(s,first.owner,"POST",base+"/brand",{name:"Harbour original brand",colors:["#f28b4e"],tone:"Warm and clear"});
  const author=(await s.db.control.query("SELECT created_by FROM brand_profile_versions WHERE brand_id=$1 AND version=1",[brand.id])).rows[0];
  assert.equal(author.created_by,first.owner.id,"The real legacy brand endpoint must retain its actual creator");
  await s.db.tx(tx=>tx.query("UPDATE brand_profiles SET version=version+1,name='Harbour original brand edited' WHERE id=$1",[brand.id]),first.tenant,true,second.id);
  const legacy=(await s.db.control.query("INSERT INTO brand_profiles(tenant_id,project_id,name) VALUES($1,$2,'Unattributed retained brand') RETURNING id",[first.tenant,first.project])).rows[0];
  return {first,second,outside,tasks:tasks.map(t=>t.id as string),otherTask:other.id as string,asset,secondAsset,brand:brand.id as string,legacyBrand:legacy.id as string};
}
