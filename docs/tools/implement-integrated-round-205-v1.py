"""Apply the complete call-scoped outcome package before unified verification."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]; P=R/'dev/copypaste-platform'
def edit(path, old, new):
    s=path.read_text('utf-8'); assert old in s,(path,str(old)[:100]); path.write_text(s.replace(old,new,1),'utf-8')
runtime=P/'src/runtime.ts'
edit(runtime,'import { RuntimeToolState, safeToolFeedback } from "./runtime-tool-feedback.js";',
'''import { RuntimeToolState } from "./runtime-tool-feedback.js";
import { RuntimeToolLedger, recoveryToolSchema, outcomeFeedback, assertDeliveredToolResult, type PendingToolOutcome } from "./tool-outcome-ledger.js";''')
edit(runtime,'  unresolvedDeliveryToolNames?: readonly string[];', '  unresolvedDeliveryToolNames?: readonly string[]; // Historical adapter fixtures only.\n  pendingToolOutcomes?: readonly PendingToolOutcome[];')
edit(runtime,'    const fingerprint = hash(', '    let fingerprint = hash(')
edit(runtime,'    if (\n      ctx.thread &&', '''    // Existing checkpoints retain their exact original declaration fingerprint.
    // New checkpoints advertise the optional recovery control and pin protocol 2.
    const outcomeProtocol = receipt?.toolOutcomeProtocol === 2 || !ctx.thread ? 2 : 1;
    if (outcomeProtocol === 2) fingerprint = hash(canonical({ original: fingerprint, toolOutcomeProtocol: 2 }));
    const declaredTools = ctx.tools.map(tool => ({ ...tool,
      inputSchema: outcomeProtocol === 2 ? recoveryToolSchema(tool.inputSchema) : tool.inputSchema }));
    if (
      ctx.thread &&''')
edit(runtime,'cloudTools: ctx.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),',
     'cloudTools: declaredTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),')
edit(runtime,'      const toolState = new RuntimeToolState(ctx.unresolvedDeliveryToolNames);',
'''      const toolState = new RuntimeToolLedger(ctx.pendingToolOutcomes);
      // Compatibility with old injected adapters is isolated from the live worker.
      const historicalState = new RuntimeToolState(ctx.unresolvedDeliveryToolNames);''')
start=runtime.read_text('utf-8').index('            const identity = {', runtime.read_text('utf-8').index('if (m.method === "item/tool/call")'))
end=runtime.read_text('utf-8').index('            child.stdin.write(JSON.stringify({ id: m.id, result })',start)
s=runtime.read_text('utf-8')
s=s[:start]+'''            const identity: Record<string, any> = {
              outcome_version: 2, tool: tool?.name ?? "unavailable_tool",
              call_ref: hash(canonical({ task: ctx.taskId, thread, turn, call: m.params?.callId ?? "" })).slice(0,16),
              arguments_sha256: hash(canonical(m.params?.arguments ?? null)),
            };
            let result: any, repair: string | undefined;
            try {
              if (!tool || !accepted || !currentTurn(m.params) || m.params.namespace != null
                || typeof m.params.callId !== "string" || !m.params.callId.length || ctx.signal.aborted)
                throw new Error("Tool not allowed");
              const prepared = toolState.prepare(tool.name, m.params.arguments);
              repair = prepared.repair; identity.arguments_sha256 = prepared.arguments_sha256;
              if (repair) identity.repair_of = repair;
              const value = await tool.run(prepared.args, m.params.callId);
              assertDeliveredToolResult(tool.name, value);
              const contentItems = runtimeToolContent(value);
              await ctx.onEvent("runtime.tool.completed", identity);
              const previous = toolState.complete(tool.name, repair);
              historicalState.complete(tool.name);
              if (previous) await ctx.onEvent("runtime.tool.recovered", { ...identity, code: previous.code });
              result = { success: true, contentItems };
            } catch (error) {
              const feedback = outcomeFeedback(error, tool ?? { name: "unavailable_tool", inputSchema: {} });
              const root = tool ? toolState.fail(tool.name, identity.call_ref, identity.arguments_sha256, feedback, repair) : identity.call_ref;
              await ctx.onEvent("runtime.tool.failed", { ...identity, failure_ref: root, ...feedback });
              result = { success: false, contentItems: [{ type: "inputText", text: JSON.stringify({
                error: { ...feedback, call_ref: identity.call_ref, failure_ref: root },
                instruction: "Only explicitly not-performed, correctable failures may be corrected using _workmate_repair_of equal to their exact failure_ref. Omit that control for independent outputs. Preserve existing authorization, original budget and receipts; never repeat unknown operations or fabricate delivery." }) }] };
            }
''' +s[end:]
runtime.write_text(s,'utf-8')
edit(runtime,'Inspect original receipts for an unverified operation and never automatically repeat uncertain side effects.',
     'For a correctable not-performed failure, set _workmate_repair_of to its exact failure_ref on the corrective call of that same tool. An independent output must omit it and cannot resolve another failed output. For legacy tool declarations this control is still accepted by the bridge. Inspect original receipts for an unverified operation and never automatically repeat uncertain side effects.')
edit(runtime,'dynamicTools: ctx.tools.map(', 'dynamicTools: declaredTools.map(')
edit(runtime,'toolState.unresolvedDelivery ? "failed" : nativeStatus', '(toolState.unresolvedDelivery || historicalState.unresolvedDelivery) ? "failed" : nativeStatus')
edit(runtime,'errorCode: toolState.unresolvedDelivery ? toolState.terminalCode : gatewayError',
     'errorCode: toolState.unresolvedDelivery ? toolState.terminalCode : historicalState.unresolvedDelivery ? historicalState.terminalCode : gatewayError')
edit(runtime,'              state: "ready",\n              thread,','              state: "ready",\n              toolOutcomeProtocol: outcomeProtocol,\n              thread,')
worker=P/'src/worker.ts'
edit(worker,'import { readUnresolvedDeliveryToolNames, deliveryFailureCode } from "./runtime-tool-feedback.js";',
     'import { readUnresolvedDeliveryToolNames, deliveryFailureCode } from "./runtime-tool-feedback.js";\nimport { readPendingToolOutcomes } from "./tool-outcome-ledger.js";')
edit(worker,'        unresolvedDeliveryToolNames: await this.db.tx(\n          tx => readUnresolvedDeliveryToolNames(tx, tenant, id), tenant, false, owner),',
     '        pendingToolOutcomes: await this.db.tx(\n          tx => readPendingToolOutcomes(tx, tenant, id), tenant, false, owner),')
feedback=P/'src/runtime-tool-feedback.ts'
s=feedback.read_text('utf-8'); a=s.index('  const rows = await tx.query(`SELECT DISTINCT ON(');b=s.index('\n}',a)
s=s[:a]+'''  const rows = await tx.query(`SELECT DISTINCT tool FROM task_tool_outcomes
    WHERE tenant_id=$1 AND task_id=$2 AND resolved_by IS NULL AND tool=ANY($3::text[])`, [tenant,task,[...deliveryTools]]);
  return rows.rows.map(row => row.tool);'''+s[b:];feedback.write_text(s,'utf-8')
events=P/'src/task-events.ts'
edit(events,'    if (["validation", "source", "permission", "execution"].includes(b.category)) payload.category = b.category;',
'''    if (["validation", "source", "permission", "execution"].includes(b.category)) payload.category = b.category;
    if (b.outcome_version === 2) payload.outcome_version = 2;
    for (const key of ["failure_ref", "repair_of"]) if (typeof b[key] === "string" && /^[a-f0-9]{16}$/.test(b[key])) payload[key] = b[key];''')
summary='''
export async function publicToolOutcomeSummary(tx: Tx, tenant: string, task: string) {
  const row = (await tx.query(`WITH pending AS MATERIALIZED (
    SELECT tool,failure_ref,call_ref,code,category,created_at FROM task_tool_outcomes
    WHERE tenant_id=$1 AND task_id=$2 AND resolved_by IS NULL
  ) SELECT (SELECT count(*)::int FROM pending) AS total,
    coalesce((SELECT jsonb_agg(to_jsonb(p)-'created_at') FROM (SELECT * FROM pending ORDER BY created_at DESC,failure_ref LIMIT 64) p),'[]'::jsonb) AS items,
    coalesce((SELECT max(id)::text FROM task_events WHERE tenant_id=$1 AND task_id=$2),'0') AS as_of_event_id`,[tenant,task])).rows[0];
  return row;
}
'''
with (P/'src/tool-outcome-ledger.ts').open('a',encoding='utf-8') as f:f.write(summary)
for filename in ['tasks.ts','task-workspace.ts']:
    p=P/'src'/filename
    edit(p,'import ', 'import { publicToolOutcomeSummary } from "./tool-outcome-ledger.js";\nimport ')
    if filename=='tasks.ts':
        edit(p,'      t.acceptance = ', '      t.tool_outcomes = await publicToolOutcomeSummary(tx, tenant, task);\n      t.acceptance = ')
    else:
        edit(p,'input_tokens:task.input_tokens,output_tokens:task.output_tokens}',
             'input_tokens:task.input_tokens,output_tokens:task.output_tokens,error_code:task.error_code,tool_outcomes:await publicToolOutcomeSummary(tx,p.tenant,p.task)}')
for repo,version in [('platform','0.5.12'),('web','0.5.14'),('desktop','0.7.18'),('delivery','0.5.12')]:
    for name in ['package.json','package-lock.json']:
        p=R/'dev'/('copypaste-'+repo)/name
        if not p.exists():continue
        doc=json.loads(p.read_text('utf-8'));doc['version']=version
        if 'packages' in doc and '' in doc['packages']:doc['packages']['']['version']=version
        p.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n','utf-8')
print('Complete server/runtime/API package applied; UI, tests and deployment tools are prepared before batch verification.')
