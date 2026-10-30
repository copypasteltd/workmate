import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireUser, type Principal } from "./auth.js";
import { key, replay } from "./access.js";
import { canonical, Problem, uuid } from "./lib.js";
import { groupRunInput, groupDefinitionHash } from "./agent-group-model.js";
import { loadGroup, prepareGroup, validateFrozenGroup, publicGroupRun, stopAgentGroupRun } from "./agent-groups.js";
import { desktopSessionBinding } from "./desktop-startup-recovery.js";
import { enqueueTask } from "./task-service.js";
import { effectivePlan } from "./plans.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { deliverySnapshot, deliveryTaskAccess } from "./business-quality.js";
import { selectTaskDelivery, writeDeliveryArchive } from "./delivery-package.js";
import type { Storage } from "./storage.js";
import { hash } from "./lib.js";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, statfs } from "node:fs/promises";
import path from "node:path";

const params = z.object({ group: uuid, run: uuid.optional() });
const approve = z.object({
  preflight_id: uuid, expected_version: z.number().int().positive(),
  definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
  approved_budget_micros: z.number().int().positive().max(1e12), confirm: z.literal(true),
  binding: desktopSessionBinding.strict(),
}).strict();
const unavailable = (code = "NATIVE_TEAM_CHANGED") => new Problem(409, code,
  "Refresh this local team, its exact specialist versions and the customer-approved budget");
const missing = () => new Problem(404, "NOT_FOUND", "Local team run not found");
type Family = (tx: Tx, actor: Principal) => Promise<string>;

/** A shared lock here precedes task locks in native admission/inference/finish.
 * The team dispatcher takes an exclusive run lock before admitting children. */
export async function lockNativeTeam(tx: Tx, task: any, active = false) {
  if (!task.agent_group_run_id || task.execution_location !== "desktop") return;
  const r = (await tx.query("SELECT * FROM agent_group_runs WHERE id=$1 FOR SHARE", [task.agent_group_run_id])).rows[0];
  if (!r || r.execution_location !== "desktop" || r.tenant_id !== task.tenant_id || r.project_id !== task.project_id
    || r.created_by !== task.created_by || r.conversation_id !== task.conversation_id
    || r.content_state !== "active" || (active && (r.state !== "running" || new Date(r.deadline_at).getTime() <= Date.now())))
    throw unavailable("NATIVE_TEAM_STOPPED");
  return r;
}

/** The company freezes scope and reserves funds; only the owning Desktop
 * starts Codex. No native member is ever placed on the cloud task queue. */
export function registerNativeAgentGroups(app: FastifyInstance, db: Database, catalog: Catalog,
  family: Family, roles: readonly string[], storage: Storage) {
  const base = "/v1/agent-groups/:group/native";
  const auth = { preHandler: requireUser(db) };
  const tenant = (req: FastifyRequest) => uuid.parse(req.headers["x-tenant-id"]);

  async function own(tx: Tx, req: FastifyRequest, writing = false, lock = false, bound = false) {
    const p = params.parse(req.params), t = tenant(req);
    const { g } = await loadGroup(tx, req.principal, t, p.group, writing);
    const f = await family(tx, req.principal);
    const r = (await tx.query(`SELECT * FROM agent_group_runs WHERE id=$1 AND group_id=$2 AND created_by=$3
      AND execution_location='desktop' AND content_state='active' AND retention_expires_at>clock_timestamp() ${lock ? "FOR UPDATE" : ""}`,
    [p.run, g.id, req.principal.id])).rows[0];
    if (!r) throw missing();
    if (bound && (r.native_binding.native_family_id !== f || r.actor_auth_version !== req.principal.authVersion))
      throw unavailable("NATIVE_TEAM_LOGIN_CHANGED");
    return { r, g, f };
  }
  function assertBinding(r: any, raw: z.infer<typeof desktopSessionBinding>, f: string) {
    if (canonical(r.native_binding) !== canonical({ ...raw, native_family_id: f })) throw unavailable("NATIVE_TEAM_DEVICE_CHANGED");
  }
  async function execution(tx: Tx, r: any, task: any, session: string) {
    const b = r.native_binding;
    return (await tx.query(`INSERT INTO desktop_executions(task_id,tenant_id,project_id,actor_id,device_id,
      local_session_id,native_family_id,workspace_hash,runtime_sha256,method_tools_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING *`,
    [task.id, r.tenant_id, r.project_id, r.created_by, b.device_id, session, b.native_family_id, b.workspace_hash, b.runtime_sha256])).rows[0];
  }
  async function assignments(tx: Tx, r: any) {
    return (await tx.query(`SELECT t.id AS task_id,t.agent_group_node_key AS step_key,t.role_key,t.role_hash,t.title,t.prompt,
      t.budget_micros::text,t.input_context->>'agent_id' AS agent_id,(t.input_context->>'agent_version')::integer AS agent_version,
      d.device_id,d.local_session_id,d.workspace_hash,d.runtime_sha256,t.status,d.state
      FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.agent_group_run_id=$1
      AND t.status IN('queued','running','paused','needs_input','awaiting_approval') ORDER BY t.id`, [r.id])).rows
      .filter(t => t.step_key !== "coordinator" || t.status !== "paused")
      .map(t => ({ task_id: t.task_id, step_key: t.step_key, role_key: t.role_key, agent_id: t.agent_id,
        agent_version: t.agent_version, title: t.title, prompt: t.prompt, budget_micros: Number(t.budget_micros),
        state: t.state, status: t.status,
        fields: { device_id: t.device_id, local_session_id: t.local_session_id, workspace_hash: t.workspace_hash,
          runtime_version: r.native_binding.runtime_version, runtime_sha256: t.runtime_sha256 } }));
  }
  async function result(tx: Tx, r: any, includeAssignments = false) {
    return { run: await publicGroupRun(tx, r), ...(includeAssignments ? { assignments: await assignments(tx, r) } : {}) };
  }

  app.post(base + "/preflight", auth, async req => {
    const t = tenant(req), p = params.parse(req.params);
    const b = z.object({ plan: groupRunInput, binding: desktopSessionBinding.strict() }).strict().parse(req.body);
    if ([...b.plan.nodes.map(n => n.budget_micros), b.plan.coordinator_budget_micros].some(n => n < 10000 || n > 10_000_000_000))
      throw unavailable("NATIVE_TEAM_STEP_BUDGET");
    return db.tx(async tx => {
      const f = await family(tx, req.principal), { g, v } = await loadGroup(tx, req.principal, t, p.group, true);
      return replay(tx, req.principal.id, "native.team.preflight:" + g.id, key(req), b, async () => {
        const definition = await prepareGroup(tx, db, catalog, req.principal, g, v, b.plan, roles.filter(r => r !== "workflow-consultant"));
        const digest = groupDefinitionHash(definition);
        const row = (await tx.query(`INSERT INTO agent_group_preflights(group_id,group_version,tenant_id,project_id,created_by,
          definition,definition_hash,approved_budget_micros,execution_location,native_binding)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'desktop',$9) RETURNING id,expires_at`,
        [g.id,g.version,t,g.project_id,req.principal.id,definition,digest,definition.approved_budget_micros,{ ...b.binding,native_family_id:f }])).rows[0];
        return { ...row, version:g.version, definition, definition_hash:digest,
          approved_budget_micros:definition.approved_budget_micros, execution_location:"desktop",
          confirmation_required:true, funds_reserved_micros:0 };
      });
    }, t, false, req.principal.id);
  });

  app.post(base + "/runs", auth, async req => {
    const t = tenant(req), p = params.parse(req.params), b = approve.parse(req.body);
    return db.tx(async tx => {
      const f = await family(tx, req.principal), { g } = await loadGroup(tx, req.principal, t, p.group, true);
      const saved = await replay(tx, req.principal.id, "native.team.create:" + g.id, key(req), b, async () => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["group-review:" + b.preflight_id]);
        const review = (await tx.query("SELECT * FROM agent_group_preflights WHERE id=$1 AND group_id=$2 AND created_by=$3 AND erased_at IS NULL",
          [b.preflight_id,g.id,req.principal.id])).rows[0];
        if (!review || review.execution_location !== "desktop" || review.group_version !== b.expected_version || g.version !== b.expected_version
          || g.state !== "active" || review.definition_hash !== b.definition_hash || Number(review.approved_budget_micros) !== b.approved_budget_micros
          || new Date(review.expires_at).getTime() <= Date.now()) throw unavailable();
        assertBinding(review,b.binding,f);
        if ((await tx.query("SELECT 1 FROM agent_group_runs WHERE preflight_id=$1", [review.id])).rowCount)
          throw unavailable("NATIVE_TEAM_REVIEW_ALREADY_USED");
        await validateFrozenGroup(tx,db,catalog,req.principal,{ ...review,content_state:"active" },roles);
        const c = review.definition.coordinator;
        const conversation = (await tx.query(`INSERT INTO conversations(tenant_id,project_id,created_by,name,agent_id,agent_version)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[t,g.project_id,req.principal.id,g.name,c.agent_id,c.agent_version])).rows[0];
        const r = (await tx.query(`INSERT INTO agent_group_runs(id,group_id,group_version,tenant_id,project_id,preflight_id,name,
          created_by,private_owner,actor_auth_version,conversation_id,definition,definition_hash,approved_budget_micros,max_parallelism,execution_location,native_binding)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,'desktop',$15) RETURNING *`,
        [randomUUID(),g.id,g.version,t,g.project_id,review.id,g.name,req.principal.id,req.principal.authVersion,conversation.id,
          review.definition,review.definition_hash,review.approved_budget_micros,review.definition.max_parallelism,review.native_binding])).rows[0];
        for (const [i,n] of r.definition.nodes.entries()) await tx.query(`INSERT INTO agent_group_nodes(run_id,step_key,tenant_id,project_id,
          position,agent_id,agent_version,role_key,role_hash,budget_micros,body,depends_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.id,n.key,t,g.project_id,i,n.agent_id,n.agent_version,n.role_key,n.role_hash,n.budget_micros,n,n.depends_on]);
        const task = await enqueueTask(tx,db,catalog,req.principal,t,g.project_id,c,`native-group:${r.id}:coordinator`,
          { context:c.context,conversation,execution_location:"desktop",role_hash:c.role_hash,
            agent_group:{ run_id:r.id,node_key:"coordinator",deferred:true } });
        await execution(tx,r,task,b.binding.local_session_id);
        await audit(tx,req.principal,"desktop.team.approve",r.id,"succeeded",
          { version:r.group_version,definition_hash:r.definition_hash,approved_budget_micros:b.approved_budget_micros },t);
        return { id:r.id };
      });
      const r = (await tx.query("SELECT * FROM agent_group_runs WHERE id=$1",[saved.id])).rows[0];
      if (!r || r.content_state !== "active") throw missing();
      assertBinding(r,b.binding,f);
      return result(tx,r);
    },t,false,req.principal.id);
  });

  app.get(base + "/runs", auth, async req => {
    const t=tenant(req),p=params.parse(req.params);
    const q=z.object({ cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(20) }).strict().parse(req.query);
    return db.tx(async tx => {
      await family(tx,req.principal); await loadGroup(tx,req.principal,t,p.group);
      const cursor=q.cursor ? (await tx.query("SELECT created_at,id FROM agent_group_runs WHERE id=$1 AND group_id=$2 AND created_by=$3 AND execution_location='desktop' AND content_state='active' AND retention_expires_at>clock_timestamp() FOR SHARE",[q.cursor,p.group,req.principal.id])).rows[0] : null;
      if (q.cursor && !cursor) throw missing();
      const rows=(await tx.query(`SELECT * FROM agent_group_runs WHERE group_id=$1 AND created_by=$2 AND execution_location='desktop'
        AND content_state='active' AND retention_expires_at>clock_timestamp() AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM agent_group_runs WHERE id=$3))
        ORDER BY created_at DESC,id DESC LIMIT $4`,[p.group,req.principal.id,q.cursor??null,q.limit+1])).rows;
      return { items:await Promise.all(rows.slice(0,q.limit).map(r=>publicGroupRun(tx,r))),next_cursor:rows.length>q.limit?rows[q.limit-1].id:null };
    },t,false,req.principal.id);
  });
  app.get(base + "/runs/:run",auth,async req=> db.tx(async tx=>result(tx,(await own(tx,req)).r),tenant(req),false,req.principal.id));

  async function delivery(tx: Tx, req: FastifyRequest) {
    const { r } = await own(tx,req);
    await tx.query("SELECT id FROM agent_group_runs WHERE id=$1 FOR SHARE",[r.id]);
    if(!["succeeded","failed","cancelled"].includes(r.state)) throw unavailable("NATIVE_TEAM_DELIVERY_NOT_READY");
    const tasks=(await tx.query("SELECT * FROM tasks WHERE agent_group_run_id=$1 ORDER BY agent_group_node_key",[r.id])).rows;
    if(!tasks.length || tasks.some(t=>!["succeeded","failed","cancelled"].includes(t.status)))
      throw unavailable("NATIVE_TEAM_RECEIPT_PENDING");
    const files: Awaited<ReturnType<typeof selectTaskDelivery>>["files"] = [], members:any[]=[];
    for(const task of tasks) {
      await deliveryTaskAccess(tx,req.principal,r.tenant_id,task.id,r.project_id);
      await assertTaskContentSources(tx,task);
      const snapshot=await deliverySnapshot(tx,task);
      if(!snapshot) throw unavailable("NATIVE_TEAM_DELIVERY_NOT_READY");
      if(!snapshot.output_sha256 && !snapshot.artifacts.length) {
        members.push({ step_key:task.agent_group_node_key,task_id:task.id,task_version:task.version,status:task.status,delivery_snapshot:snapshot,files:[] });
        continue;
      }
      const selected=await selectTaskDelivery(tx,req.principal,{ tenant:r.tenant_id,project:r.project_id,task:task.id },
        { expected_version:task.version,expected_delivery_hash:hash(canonical(snapshot)) });
      const prefix=task.agent_group_node_key==="coordinator"?"coordinator/":`members/${task.agent_group_node_key}/`;
      files.push(...selected.files.map(f=>({...f,path:prefix+f.path})));
      members.push({ step_key:task.agent_group_node_key,...selected.manifest,
        files:selected.manifest.files.map(f=>({...f,path:prefix+f.path})) });
    }
    if(!files.length) throw unavailable("DELIVERY_MISSING");
    if(files.length>10000 || files.reduce((n,f)=>n+f.bytes,0)>16*1024**3)
      throw new Problem(413,"DELIVERY_PACKAGE_CAPACITY","The team exceeds the 16 GiB or 10,000 file export capacity");
    const manifest={ format:"workmate-native-team-delivery-1",tenant_id:r.tenant_id,project_id:r.project_id,
      run_id:r.id,group_id:r.group_id,group_version:r.group_version,run_revision:r.revision,state:r.state,
      definition_hash:r.definition_hash,approved_budget_micros:Number(r.approved_budget_micros),
      complete_team:r.state==="succeeded",execution_location:"desktop",members,
      files:files.map(({storage_key:_key,content:_content,...f})=>f),
      local_workspace:"Only explicitly submitted task outputs are included. Local-only files remain on the customer's computer." };
    return {r,files,manifest,delivery_hash:hash(canonical(manifest))};
  }
  app.get(base+"/runs/:run/delivery",auth,async req=>db.tx(async tx=>{
    const d=await delivery(tx,req);
    return { run_id:d.r.id,revision:d.r.revision,delivery_hash:d.delivery_hash,complete_team:d.manifest.complete_team,
      file_count:d.files.length,bytes:d.files.reduce((n,f)=>n+f.bytes,0),manifest:d.manifest };
  },tenant(req),false,req.principal.id));
  const exports = new Set<string>();
  app.get(base+"/runs/:run/download",{...auth,config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async(req,reply)=>{
    const q=z.object({expected_revision:z.coerce.number().int().positive(),expected_delivery_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.query);
    if(exports.size>=2 || exports.has(req.principal.id)) throw new Problem(429,"DELIVERY_EXPORT_BUSY","Another team export is in progress");
    exports.add(req.principal.id);
    const abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(300000)]),interrupt=()=>abort.abort();
    req.raw.once("aborted",interrupt);reply.raw.once("close",interrupt);
    let directory:string|undefined,handedOff=false;
    const cleanup=async()=>{req.raw.off("aborted",interrupt);reply.raw.off("close",interrupt);exports.delete(req.principal.id);
      if(directory)await rm(directory,{recursive:true,force:true});};
    const selected=async(tx:Tx)=>{const d=await delivery(tx,req);
      if(d.r.revision!==q.expected_revision || d.delivery_hash!==q.expected_delivery_hash) throw unavailable("DELIVERY_VERSION_CONFLICT");return d;};
    try {
      const d=await db.tx(selected,tenant(req),false,req.principal.id);
      await mkdir(db.config.DATA_DIR,{recursive:true});const parent=await realpath(db.config.DATA_DIR),capacity=await statfs(parent);
      if(Number(capacity.bavail)*Number(capacity.bsize)<d.files.reduce((n,f)=>n+f.bytes,0)+64*1024**2)
        throw new Problem(503,"DELIVERY_EXPORT_BUSY","Export storage is currently full");
      directory=await mkdtemp(path.join(parent,"native-team-delivery-"));
      const readme=`# CopyPaste · 本機團隊交付 / Local team delivery\n\n團隊 / Team: ${d.r.id} · v${d.r.group_version}\n\n`+
        (d.manifest.complete_team?"全部成員及協調員已成功完成。 / All members and the coordinator completed successfully.\n\n":"這是停止或失敗團隊的現有部分成果。 / These are partial outputs of a stopped or failed team.\n\n")+
        "先閱讀 coordinator/result.md，再查看 members/ 的各步成果。manifest.json 記錄每個任務及檔案版本；SHA256SUMS 可核對完整性。\nRead coordinator/result.md first, then each step under members/. manifest.json records exact task and file versions; verify SHA256SUMS.\n\n"+
        "下載不執行程式、不呼叫 AI、不新增 AI 費用。本機未提交的檔案仍留在客戶電腦。\nDownloading executes no code, calls no AI and adds no AI charge. Unsubmitted local files stay on the customer's computer.\n\n"+
        "原始碼與工程包請另行解壓並按隨附說明編輯；MP4/PNG/PDF 不代表已包含可編輯工程。\nExtract source and project packages separately and follow their instructions. MP4/PNG/PDF outputs do not imply editable source projects.\n";
      const archive=await writeDeliveryArchive(directory,d.files,d.manifest,storage,signal,readme);
      await db.tx(async tx=>{await selected(tx);await audit(tx,req.principal,"desktop.team.delivery.download",d.r.id,"succeeded",
        {revision:d.r.revision,delivery_hash:d.delivery_hash,files:d.files.length,bytes:archive.bytes,sha256:archive.sha256},tenant(req));},tenant(req),false,req.principal.id);
      signal.throwIfAborted();const stream=createReadStream(archive.output);
      stream.once("close",()=>{void cleanup().catch(e=>app.log.error(e,"Native team export cleanup failed"));});handedOff=true;
      return reply.type("application/zip").header("Cache-Control","no-store").header("Content-Length",archive.bytes)
        .header("X-Content-SHA256",archive.sha256).header("Content-Disposition",`attachment; filename="workmate-team-${d.r.id}.zip"`).send(stream);
    }finally{if(!handedOff)await cleanup();}
  });

  app.post(base + "/runs/:run/advance", auth, async req => {
    const t=tenant(req),b=z.object({ expected_revision:z.number().int().positive(),binding:desktopSessionBinding.strict() }).strict().parse(req.body);
    return db.tx(async tx => {
      let { r,f }=await own(tx,req,true,true,true); assertBinding(r,b.binding,f);
      if (r.state!=="running") return result(tx,r);
      if (r.revision!==b.expected_revision) throw unavailable("NATIVE_TEAM_REVISION_CHANGED");
      await tx.query("SAVEPOINT native_team_advance");
      try {
        if(new Date(r.deadline_at).getTime()<=Date.now()) throw unavailable("NATIVE_TEAM_DEADLINE");
        await validateFrozenGroup(tx,db,catalog,req.principal,r,roles);
        const nodes=(await tx.query(`SELECT n.*,t.status AS task_status,t.cancel_requested,t.content_state AS task_content
          FROM agent_group_nodes n LEFT JOIN tasks t ON t.id=n.task_id WHERE run_id=$1 ORDER BY position`,[r.id])).rows;
        for(const n of nodes) {
          if(n.task_id && (n.cancel_requested || n.task_content!=="active" || ["failed","cancelled","reconciling"].includes(n.task_status))) {
            await stopAgentGroupRun(tx,r,n.task_status==="reconciling"?"reconciling":"failed","NATIVE_TEAM_MEMBER_"+(n.task_status??"UNAVAILABLE").toUpperCase());
            return result(tx,(await tx.query("SELECT * FROM agent_group_runs WHERE id=$1",[r.id])).rows[0]);
          }
          if(n.state==="active" && n.task_status==="succeeded") {
            const child=(await tx.query("SELECT * FROM tasks WHERE id=$1",[n.task_id])).rows[0];
            await assertTaskContentSources(tx,child);
            // Composition, generated media and audio must have actual terminal outputs.
            const media=(await tx.query("SELECT DISTINCT ON(video_id) state FROM video_renders WHERE origin_task_id=$1 ORDER BY video_id,version DESC,created_at DESC,id DESC",[child.id])).rows;
            const generated=(await tx.query("SELECT state,delivery_state FROM ai_video_jobs WHERE task_id=$1",[child.id])).rows;
            const audio=(await tx.query("SELECT * FROM native_group_audio_states($1)",[child.id])).rows;
            if(media.some(m=>["queued","rendering"].includes(m.state)) || generated.some(m=>["prepared","submitting","queued","in_progress"].includes(m.state))
              || audio.some(m=>["prepared","dispatched"].includes(m.state))) continue;
            if(media.some(m=>m.state!=="succeeded") || [...generated,...audio].some(m=>m.state!=="completed" || m.delivery_state!=="available"))
              throw unavailable("NATIVE_TEAM_MEDIA_FAILED");
            await tx.query("UPDATE agent_group_nodes SET state='succeeded' WHERE run_id=$1 AND step_key=$2",[r.id,n.step_key]); n.state="succeeded";
          }
        }
        const coordinator=(await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[r.coordinator_task_id])).rows[0];
        if(!coordinator || coordinator.cancel_requested || ["failed","cancelled","reconciling"].includes(coordinator.status))
          throw unavailable("NATIVE_TEAM_COORDINATOR_UNAVAILABLE");
        if(coordinator.status==="succeeded") {
          await assertTaskContentSources(tx,coordinator);
          r=(await tx.query("UPDATE agent_group_runs SET state='succeeded',revision=revision+1 WHERE id=$1 RETURNING *",[r.id])).rows[0];
          return result(tx,r);
        }
        if(nodes.every(n=>n.state==="succeeded")) {
          if(coordinator.status==="paused") {
            await assertTaskContentSources(tx,coordinator);
            if(coordinator.attempt!==0) throw unavailable("NATIVE_TEAM_COORDINATOR_CHECKPOINT_CHANGED");
            await tx.query("UPDATE tasks SET status='queued',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND status='paused' AND attempt=0",[coordinator.id]);
            r=(await tx.query("UPDATE agent_group_runs SET revision=revision+1 WHERE id=$1 RETURNING *",[r.id])).rows[0];
          }
          return result(tx,r,true);
        }
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["task-quota:"+t+":"+req.principal.id]);
        const plan=await effectivePlan(tx,t,req.principal.id);
        const count=Number((await tx.query("SELECT count(*) AS n FROM tasks WHERE tenant_id=$1 AND created_by=$2 AND status IN('queued','running','paused','awaiting_approval','reconciling','needs_input')",[t,req.principal.id])).rows[0].n);
        let slots=Math.min(r.max_parallelism-nodes.filter(n=>n.state==="active").length,plan.body.max_active_tasks-count);
        const conversation=(await tx.query("SELECT * FROM conversations WHERE id=$1 AND content_state='active' AND archived=false",[r.conversation_id])).rows[0];
        if(!conversation) throw missing();
        for(const n of nodes) {
          if(slots<=0) break;
          if(n.state!=="pending" || !n.depends_on.every((k:string)=>nodes.find(d=>d.step_key===k)?.state==="succeeded")) continue;
          const task=await enqueueTask(tx,db,catalog,req.principal,t,r.project_id,{ ...n.body,parent_id:r.coordinator_task_id },`native-group:${r.id}:${n.step_key}`,
            { context:n.body.context,conversation,execution_location:"desktop",role_hash:n.role_hash,agent_group:{ run_id:r.id,node_key:n.step_key } });
          await execution(tx,r,task,n.native_local_session_id);
          r=(await tx.query("UPDATE agent_group_runs SET revision=revision+1 WHERE id=$1 RETURNING *",[r.id])).rows[0]; slots--;
          await audit(tx,req.principal,"desktop.team.member.prepared",task.id,"succeeded",{ run_id:r.id,step_key:n.step_key,role_key:n.role_key },t);
        }
        return result(tx,r,true);
      } catch(error) {
        await tx.query("ROLLBACK TO SAVEPOINT native_team_advance");
        if(!(error instanceof Problem)) throw error;
        await stopAgentGroupRun(tx,r,"failed",error.code);
        return result(tx,(await tx.query("SELECT * FROM agent_group_runs WHERE id=$1",[r.id])).rows[0]);
      }
    },t,false,req.principal.id);
  });
  app.post(base + "/runs/:run/cancel",auth,async req=> {
    const b=z.object({ expected_revision:z.number().int().positive() }).strict().parse(req.body);
    return db.tx(async tx=> {
      const {r}=await own(tx,req,true,true);
      const receipt=await replay(tx,req.principal.id,"native.team.cancel:"+r.id,key(req),b,async()=>{
        if(r.revision!==b.expected_revision) throw unavailable("NATIVE_TEAM_REVISION_CHANGED");
        await stopAgentGroupRun(tx,r,"cancelled","NATIVE_TEAM_CUSTOMER_CANCELLED");
        await audit(tx,req.principal,"desktop.team.cancel",r.id,"succeeded",{},r.tenant_id);
        return {id:r.id};
      });
      return result(tx,(await tx.query("SELECT * FROM agent_group_runs WHERE id=$1",[receipt.id])).rows[0]);
    },tenant(req),false,req.principal.id);
  });
}
