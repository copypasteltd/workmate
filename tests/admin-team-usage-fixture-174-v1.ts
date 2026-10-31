import assert from "node:assert/strict";
import type { System } from "./admin-history-fixture.js";
import { historyOk } from "./admin-history-fixture.js";
import { overviewWorkspace, overviewTask, overviewSettle } from "./admin-overview-fixture-160-v2.js";
import { advanceAgentGroups } from "../src/agent-groups.js";

/** Real team create/preflight/approve/dispatch and financial settlement APIs.
 * Accounting is explicitly synthetic; no model or professional-team execution
 * quality is claimed by this report fixture. No database guards are disabled. */
export async function teamUsageFixture(s: System) {
  const first = await overviewWorkspace(s), second = await overviewWorkspace(s);
  const base = `/v1/tenants/${first.tenant}/projects/${first.project}`;
  const agents = [];
  for (const name of ["Private coordinator", "Private marketing specialist"])
    agents.push(await historyOk(s, first.owner, "POST", base + "/agents", { name, role_key: "assistant", instructions: "Explicit synthetic team accounting; do not make model calls." }));
  const privateName = "Private campaign brief must not appear in billing";
  const group = await historyOk(s, first.owner, "POST", "/v1/agent-groups", { project_id: first.project, name: privateName, coordinator_agent_id: agents[0].id, members: [{ agent_id: agents[1].id, role_description: "Prepare the campaign draft" }] });
  const runs: any[] = [];
  for (let i = 0; i < 2; i++) {
    const p = await historyOk(s, first.owner, "POST", `/v1/agent-groups/${group.id}/preflight`, {
      expected_version: group.version, brief: "Explicit synthetic accounting report fixture, with no model call.",
      nodes: [{ key: "draft", agent_id: agents[1].id, title: "Synthetic campaign draft", prompt: "Clearly synthetic accounting fixture", depends_on: [], budget_micros: 600000 }],
      coordinator_budget_micros: 300000, max_parallelism: 1,
    });
    runs.push(await historyOk(s, first.owner, "POST", `/v1/agent-groups/${group.id}/runs`, { preflight_id: p.id, expected_version: p.version, definition_hash: p.definition_hash, approved_budget_micros: p.approved_budget_micros, confirm: true }));
  }
  await advanceAgentGroups(s.db, s.catalog);
  const tasks: any[] = [];
  for (let i = 0; i < runs.length; i++) {
    const current = await historyOk(s, first.owner, "GET", `/v1/agent-groups/${group.id}/runs/${runs[i].id}`);
    assert.equal(current.tasks.length, 2);
    for (const task of current.tasks) {
      const coordinator = task.id === current.coordinator_task_id;
      const cost = coordinator ? (i ? 90007 : 70001) : (i ? 230005 : 130003);
      await overviewSettle(s, first, task.id, cost);
      await s.db.control.query("UPDATE tasks SET status='succeeded',attempt=1 WHERE id=$1", [task.id]);
      tasks.push({ id: task.id as string, run: current.id as string, node: coordinator ? "coordinator" : "draft", cost: String(cost) });
    }
  }
  const standalone = await overviewTask(s, first), outside = await overviewTask(s, second);
  await overviewSettle(s, first, standalone.id, 110009); await overviewSettle(s, second, outside.id, 990011);
  await s.db.control.query("UPDATE tasks SET status='succeeded',attempt=1 WHERE id=ANY($1::uuid[])", [[standalone.id, outside.id]]);
  const filters = { period_from: new Date(Date.now() - 86400000).toISOString(), period_to: new Date(Date.now() + 86400000).toISOString(), user_id: first.owner.id };
  return { first, second, group: group.id as string, runs: runs.map(r => r.id as string), tasks, standalone: standalone.id as string, outside: outside.id as string, filters, privateName };
}
