import { createHash } from "node:crypto";

export interface LocalTeamBinding {
  device_id: string; local_session_id: string; workspace_hash: string;
  runtime_version: string; runtime_sha256: string;
}
export interface LocalTeamMember {
  key: string; agent_id: string; agent_version: number; role_key: string;
  member_name: string; role_hash: string; title: string; prompt: string;
  depends_on: string[]; budget_micros: number;
}
export interface LocalTeamReview {
  id: string; version: number; definition_hash: string; approved_budget_micros: number;
  execution_location: "desktop"; confirmation_required: true; funds_reserved_micros: 0;
  definition: { execution_location: "desktop"; max_parallelism: number; approved_budget_micros: number;
    brief: string; coordinator: LocalTeamMember; nodes: LocalTeamMember[] };
}
export interface LocalTeamRun {
  id: string; group_id: string; revision: number; version: number; state: string;
  execution_location: "desktop"; definition_hash: string; approved_budget_micros: number;
  charged_micros: number; reserved_micros: number; coordinator_task_id: string;
  nodes: { task_id: string | null; step_key: string; state: string }[];
  tasks: { id: string; status: string; step_key: string }[];
}
export interface LocalTeamAssignment {
  task_id: string; step_key: string; role_key: string; agent_id: string; agent_version: number;
  title: string; prompt: string; budget_micros: number; status: string; state: string;
  fields: LocalTeamBinding;
}
export interface LocalTeamState {
  group: string; review: LocalTeamReview; binding: LocalTeamBinding; createKey: string;
  run?: LocalTeamRun; phase: "review" | "accepting" | "running" | "interrupted" | "finished";
  cancelled?: boolean; cancelKey?: string; cancelRevision?: number; error?: string;
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digestPattern = /^[a-f0-9]{64}$/;
export const localTeamTerminal = new Set(["succeeded", "failed", "cancelled", "reconciling"]);
const fail = (): never => { throw new Error("LOCAL_TEAM_CONTRACT_INVALID"); };
const positive = (n: unknown, max = Number.MAX_SAFE_INTEGER) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= max;
const amount = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1e12;
export function canonicalTeam(value: any): string {
  if(value===null || typeof value!=="object") return JSON.stringify(value);
  if(Array.isArray(value)) return "["+value.map(canonicalTeam).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalTeam(value[k])).join(",")+"}";
}
export const localTeamDigest = (value: unknown) => createHash("sha256").update(canonicalTeam(value)).digest("hex");
export function parseTeamReview(raw: any): LocalTeamReview {
  if(!raw || !uuid.test(raw.id) || !positive(raw.version) || !digestPattern.test(raw.definition_hash)
    || raw.execution_location!=="desktop" || raw.confirmation_required!==true || raw.funds_reserved_micros!==0
    || !positive(raw.approved_budget_micros,1e12) || localTeamDigest(raw.definition)!==raw.definition_hash) fail();
  const d=raw.definition;
  if(d.execution_location!=="desktop" || !positive(d.max_parallelism,3) || d.approved_budget_micros!==raw.approved_budget_micros
    || typeof d.brief!=="string" || !d.brief.trim() || d.brief.length>8000 || !Array.isArray(d.nodes) || !d.nodes.length || d.nodes.length>16) fail();
  for(const n of [d.coordinator,...d.nodes]) {
    if(!n || !/^[a-z][a-z0-9_]{0,39}$/.test(n.key) || !uuid.test(n.agent_id) || !positive(n.agent_version)
      || !/^[a-z][a-z0-9-]{0,79}$/.test(n.role_key) || n.role_key==="workflow-consultant" || !digestPattern.test(n.role_hash)
      || typeof n.member_name!=="string" || !n.member_name.trim() || n.member_name.length>160
      || typeof n.title!=="string" || !n.title.trim() || n.title.length>160
      || typeof n.prompt!=="string" || !n.prompt.trim() || n.prompt.length>30000
      || !positive(n.budget_micros,10_000_000_000) || n.budget_micros<10000
      || !Array.isArray(n.depends_on) || new Set(n.depends_on).size!==n.depends_on.length) fail();
  }
  if(d.coordinator.key!=="coordinator" || d.coordinator.role_key!=="assistant"
    || new Set(d.nodes.map((n:LocalTeamMember)=>n.key)).size!==d.nodes.length || d.nodes.some((n:LocalTeamMember)=>n.key==="coordinator")) fail();
  const complete=new Set<string>(), visiting=new Set<string>();
  const visit=(key:string)=>{
    if(visiting.has(key)) fail(); if(complete.has(key)) return;
    const n=d.nodes.find((n:LocalTeamMember)=>n.key===key); if(!n) fail();
    visiting.add(key); for(const k of n.depends_on) visit(k); visiting.delete(key); complete.add(key);
  };
  for(const n of d.nodes) visit(n.key);
  if(canonicalTeam([...d.coordinator.depends_on].sort())!==canonicalTeam(d.nodes.map((n:LocalTeamMember)=>n.key).sort())
    || [d.coordinator,...d.nodes].reduce((sum,n)=>sum+n.budget_micros,0)!==raw.approved_budget_micros) fail();
  return structuredClone(raw);
}
export function parseTeamRun(raw: any, team: LocalTeamState): LocalTeamRun {
  if(!raw || !uuid.test(raw.id) || raw.group_id!==team.group || (team.run && raw.id!==team.run.id)
    || raw.execution_location!=="desktop" || !positive(raw.revision) || raw.revision<(team.run?.revision??1)
    || raw.version!==team.review.version || raw.definition_hash!==team.review.definition_hash
    || localTeamDigest(raw.definition)!==team.review.definition_hash || raw.approved_budget_micros!==team.review.approved_budget_micros
    || raw.max_parallelism!==team.review.definition.max_parallelism || !amount(raw.charged_micros) || !amount(raw.reserved_micros)
    || raw.charged_micros>raw.approved_budget_micros || raw.reserved_micros>raw.approved_budget_micros || !uuid.test(raw.coordinator_task_id)
    || !["running",...localTeamTerminal].includes(raw.state) || !Array.isArray(raw.nodes) || raw.nodes.length!==team.review.definition.nodes.length
    || !Array.isArray(raw.tasks) || raw.tasks.length>team.review.definition.nodes.length+1) fail();
  if(new Set(raw.nodes.map((n:any)=>n.step_key)).size!==raw.nodes.length || new Set(raw.tasks.map((t:any)=>t.id)).size!==raw.tasks.length) fail();
  for(const n of raw.nodes) if(!team.review.definition.nodes.some(d=>d.key===n.step_key)
    || !["pending","active","succeeded","failed","cancelled"].includes(n.state) || (n.task_id!==null && !uuid.test(n.task_id))) fail();
  for(const t of raw.tasks) if(!uuid.test(t.id) || (t.step_key==="coordinator" ? t.id!==raw.coordinator_task_id : !raw.nodes.some((n:any)=>n.step_key===t.step_key && n.task_id===t.id))) fail();
  if(raw.state==="succeeded" && (raw.nodes.some((n:any)=>n.state!=="succeeded") || raw.tasks.length!==raw.nodes.length+1
    || raw.tasks.some((t:any)=>t.status!=="succeeded"))) fail();
  return structuredClone(raw);
}
export function parseTeamAssignments(raw: any, team: LocalTeamState): LocalTeamAssignment[] {
  if(!Array.isArray(raw) || raw.length>team.review.definition.max_parallelism) fail();
  const sessions=new Set<string>(), tasks=new Set<string>(), b=team.binding;
  for(const a of raw) {
    const n=[team.review.definition.coordinator,...team.review.definition.nodes].find(n=>n.key===a?.step_key);
    if(!n || !uuid.test(a.task_id) || tasks.has(a.task_id) || !uuid.test(a.fields?.local_session_id)
      || sessions.has(a.fields.local_session_id) || a.role_key!==n.role_key || a.agent_id!==n.agent_id || a.agent_version!==n.agent_version
      || a.title!==n.title || a.prompt!==n.prompt || a.budget_micros!==n.budget_micros
      || a.fields.device_id!==b.device_id || a.fields.workspace_hash!==b.workspace_hash
      || a.fields.runtime_version!==b.runtime_version || a.fields.runtime_sha256!==b.runtime_sha256
      || !["prepared","running"].includes(a.state) || !["queued","running","needs_input","awaiting_approval"].includes(a.status)
      || (a.step_key==="coordinator" ? a.fields.local_session_id!==b.local_session_id || a.task_id!==team.run?.coordinator_task_id
        : a.fields.local_session_id===b.local_session_id || !team.run?.nodes.some(n=>n.step_key===a.step_key && n.task_id===a.task_id))) fail();
    sessions.add(a.fields.local_session_id); tasks.add(a.task_id);
  }
  return structuredClone(raw);
}
