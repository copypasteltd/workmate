import { randomUUID } from "node:crypto";
import { historyFixture, historyOk, type System } from "./admin-history-fixture.js";
import { defaults } from "../src/plans.js";
import { saveAsset } from "../src/storage.js";
import { canonical, hash } from "../src/lib.js";
import { editableDesignSchema, vectorInput, slidesInput } from "../src/editable-design-model.js";

export async function businessHistoryFixture(s: System, versions = 105, authenticateAdmin = true) {
  const f = await historyFixture(s, {versions: 1, notes: 1, authenticateAdmin});
  const ok = (method: string, url: string, body?: any) => historyOk(s, f.owner, method, url, body);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic history fixture; no payment',$2)", [f.tenant, defaults.business]);
  const posterBody = (n: number) => ({width: 800, height: 600, background: "#f6f6f4", layers: [{type: "text", text: `Saved campaign version ${n}`, x: 24, y: 24, font_size: 32, color: "#15171a"}]});
  const poster = await ok("POST", f.base + "/creative", {name: "Campaign canvas history", body: posterBody(1)});
  const brandBody = (n: number) => ({schema_version: 2, name: "Campaign brand history", colors: ["#f6f6f4", "#15171a"], tone: `Approved voice version ${n}`,
    font_bindings: [{key: "body", label: "Noto Sans TC", source: {builtin: "noto-sans-tc"}, rights: {source: "Noto project", license: "SIL Open Font License 1.1", channels: ["web"], valid_until: null}}],
    facts: [], logos: [], locales: ["en-HK"], channels: ["web"]});
  const brand = await ok("POST", f.base + "/brand/definitions", brandBody(1));
  for (let n = 2; n <= versions; n++) {
    await ok("PUT", f.base + "/creative/" + poster.id, {name: poster.name, version: n-1, body: posterBody(n)});
    await ok("PUT", f.base + "/brand/definitions/" + brand.id, {expected_version: n-1, definition: brandBody(n)});
  }
  const other = await ok("POST", f.base + "/agents", {name: "Campaign reviewer", role_key: "assistant", instructions: "Review authorized marketing work."});
  const group = await ok("POST", "/v1/agent-groups", {project_id: f.project, name: "Campaign team history", coordinator_agent_id: f.agent.id,
    members: [{agent_id: other.id, role_description: "Review approved deliverables"}]});
  await ok("PATCH", "/v1/agent-groups/"+group.id, {expected_version:1,name:"Campaign team history"});
  const definition = {schema_version: 1, name: "Campaign brief history", instructions: "Approved campaign facts", delivery_requirements: "Chinese and English", default_agent: null,
    brand: null, asset_version_ids: [], connection_ids: [], max_task_budget_micros: null};
  const draft = await ok("PUT", f.base + "/project-configuration/draft", {expected_revision: 0, definition});
  const preview = await ok("POST", f.base + "/project-configuration/preview", {expected_revision: draft.revision});
  await ok("POST", f.base + "/project-configuration/publish", {expected_revision: draft.revision, draft_sha256: preview.draft_sha256});
  const config = (await s.db.control.query("SELECT * FROM project_configurations WHERE project_id=$1", [f.project])).rows[0];
  const workflow = await ok("POST", f.base + "/workflows", {name: "History approval workflow", definition: {steps: [{kind: "approval", message: "Review saved campaign history"}]}});
  await ok("POST", `${f.base}/workflows/${workflow.id}/publish`);
  const scheduleInput = {name: "Campaign schedule history", workflow_id: workflow.id, calendar: {timezone: "Asia/Hong_Kong", frequency: "daily", time: "09:00"}, catch_up: "latest", starts_at: new Date(Date.now()+3_600_000).toISOString()};
  const schedulePreview = await ok("POST", f.base + "/workflow-schedules/preview", scheduleInput);
  const schedule = await ok("POST", f.base + "/workflow-schedules", {...schedulePreview.input, expected_workflow_version: schedulePreview.workflow_version, expected_definition_hash: schedulePreview.definition_hash});
  const videoDefinition = {schema_version:"copypaste-video-1",template:"campaign-cuts-1",locale:"en",width:256,height:456,
    frame_rate:{numerator:30,denominator:1},duration_frames:90,script:{title:"Campaign video",brief:"Saved input",narration:"Provided copy",call_to_action:"Learn more"},
    brand:{label:"CopyPaste",background:"#f6f6f4",ink:"#15171a",accent:"#2352df",logo:null},storyboard:[{key:"opening",start_frame:0,end_frame:90,direction:"Opening",headline:"A new campaign",body:"For the team",image:null}],subtitles:[],audio:null};
  const video=await ok("POST",f.base+"/video-projects",{name:"Campaign video history",definition:videoDefinition});
  const editable: any[] = [];
  for (const kind of ["vector", "presentation"] as const) {
    const scene = {width: 800, height: 600, background: "#f6f6f4", layers: [{kind: "text", id: "headline", x: 24, y: 24, w: 560, h: 80, text: "A saved campaign.", font_size: 32, weight: 700, color: "#15171a"}]};
    const common = {title: "Campaign version history", locale: "en-HK"}, input = kind === "vector"
      ? vectorInput.parse({...common, purpose: "Campaign vector", scene})
      : slidesInput.parse({...common, audience: "Marketing team", decision: "Review campaign", slides: [{id: "opening", title: "Launch", notes: "Saved notes version 1", scene}]});
    const bytes = Buffer.from(JSON.stringify({schema: editableDesignSchema, kind, input, input_sha256: hash(canonical(input)), data_mode: "simulated"}));
    const source = await s.db.tx(tx => saveAsset(tx, s.storage, {tenant: f.tenant, project: f.project, user: f.owner.id, name: kind+".source.json", bytes, mime: "application/json", metadata: {editable_design_schema: editableDesignSchema, design_kind: kind, data_mode: "simulated"}}), f.tenant, false, f.owner.id);
    const project = await ok("POST", f.base + "/editable-projects", {name: "Campaign " + kind + " history", source_version_id: source.version.id, sha256: source.version.sha256, confirm_project_sharing: true});
    const nextInput = structuredClone(input); nextInput.title = "Campaign version 2";
    await ok("PUT", f.base + "/editable-projects/" + project.id, {name: project.name, expected_version: 1, input: nextInput});
    editable.push({...project, input, source});
  }
  // Explicit SQL fixtures exercise composite paging; they do not claim a customer matrix journey.
  const matrix = (await s.db.control.query("INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by) VALUES($1,$2,'Batch design history','creative_matrix','{}',$3) RETURNING *", [f.tenant,f.project,f.owner.id])).rows[0];
  const units: any[] = [];
  for (let i=0;i<2;i++) {
    const unit = (await s.db.control.query("INSERT INTO creative_matrix_units(tenant_id,project_id,batch_id,creative_key,locale,size_key,actor_id,actor_auth_version,revision) VALUES($1,$2,$3,$4,'en','square',$5,1,31) RETURNING *", [f.tenant,f.project,matrix.id,"campaign-"+i,f.owner.id])).rows[0];
    for (let n=1;n<=31;n++) {
      const input = {copy: {headline: `Unit ${i} version ${n}`}, image: null};
      await s.db.control.query("INSERT INTO creative_matrix_revisions(tenant_id,project_id,unit_id,revision,input,input_hash,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [f.tenant,f.project,unit.id,n,input,hash(canonical(input)),f.owner.id]);
    }
    units.push(unit);
  }
  return {...f, poster, posterBody, brand, brandBody, group, config, workflow, schedule, video, videoDefinition, editable, matrix, units, versions};
}
