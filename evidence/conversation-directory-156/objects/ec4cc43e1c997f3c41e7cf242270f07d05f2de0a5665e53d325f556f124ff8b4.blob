import {historyFixture,type System} from "./admin-history-fixture.js";
export async function conversationDirectoryFixture(s:System){
 const f=await historyFixture(s,{versions:1,notes:0,authenticateAdmin:false});
 await s.db.control.query(`INSERT INTO conversations(tenant_id,project_id,created_by,name,agent_id,agent_version,pinned,archived,updated_at)
 SELECT $1,$2,$3,'Campaign discussion',$4,1,n%17=0,false,'2020-01-01T00:00:00Z'::timestamptz+(n%3)*interval '1 microsecond' FROM generate_series(1,235) n`,[f.tenant,f.project,f.owner.id,f.agent.id]);
 await s.db.control.query(`INSERT INTO conversations(tenant_id,project_id,created_by,name,agent_id,agent_version,pinned,archived,updated_at)
 SELECT $1,$2,$3,'Campaign archived',$4,1,n%19=0,true,'2020-01-01T00:00:00Z'::timestamptz+(n%3)*interval '1 microsecond' FROM generate_series(1,207) n`,[f.tenant,f.project,f.owner.id,f.agent.id]);
 return f;
}
export async function directoryOracle(s:System,f:Awaited<ReturnType<typeof conversationDirectoryFixture>>,archived=false,q=""){
 return (await s.db.control.query("SELECT id FROM conversations WHERE project_id=$1 AND created_by=$2 AND archived=$3 AND content_state='active' AND ($4='' OR position(lower($4) in lower(name))>0) ORDER BY pinned DESC,updated_at DESC,id DESC",[f.project,f.owner.id,archived,q])).rows.map(x=>x.id);
}
