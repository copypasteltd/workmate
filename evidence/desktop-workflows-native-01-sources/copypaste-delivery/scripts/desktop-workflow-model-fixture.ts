import assert from "node:assert/strict";
import path from "node:path";

/** Explicit synthetic Responses only. Native commands, company results,
 * approvals, fees and files must actually exist before the fixture continues. */
export class DesktopWorkflowModelFixture {
  private mode: "execute" | "stop" | "revoke" | null = null;
  private actions: string[] = [];
  private pending: { name: string; call: string } | null = null;
  private children = new Map<string, { call: string; stage: "command" | "question" | "done" }>();
  private published: any;
  definition: any;
  runId = "";
  observations: { tool: string; actual_output: boolean }[] = [];
  constructor(readonly workspace: string, readonly outside: string) {}
  begin(mode: "execute" | "stop" | "revoke") {
    this.mode = mode; this.children.clear(); this.pending = null; this.published = undefined; this.runId = "";
    this.definition = { steps: mode === "execute" ? [
      { kind: "codex", role_key: "fullstack", prompt: "NATIVE_FLOW_FIRST: Write the authorized native checklist and outside marker, then verify both files.", budget_micros: 100000 },
      { kind: "approval", message: "Review the real local checklist before the native QA step runs." },
      { kind: "codex", role_key: "software-qa", prompt: "NATIVE_FLOW_QA: Read the real checklist and write the verified native QA result.", budget_micros: 100000 },
    ] : [{ kind: "codex", role_key: "fullstack", prompt: `NATIVE_FLOW_${mode.toUpperCase()}: Start the bounded local command and wait for the customer.`, budget_micros: 100000 }] };
    this.actions = ["workflow_save", "workflow_publish", "workflow_run", ...(mode === "execute" ? ["deliver_text", "deliver_text", "deliver_text"] : [])];
  }
  private output(body: any, call: string) {
    const output = body.input.find((entry: any) => entry.type === "function_call_output" && entry.call_id === call);
    assert.ok(output, "A real native tool output is required; do not insert a synthetic result");
    if (typeof output.output === "string") return output.output;
    assert.ok(Array.isArray(output.output) && output.output.length === 1);
    assert.ok(["input_text", "text"].includes(output.output[0].type));
    assert.equal(typeof output.output[0].text, "string"); return output.output[0].text;
  }
  next(body: any, serial: number): any | null {
    if (!this.mode) return null;
    const tools = (body.tools ?? []).flatMap((tool: any) => tool.type === "namespace"
      ? tool.tools.map((child: any) => ({ ...child, name: tool.name + "." + child.name })) : [tool]);
    const parent = tools.some((tool: any) => tool.name === "copypaste.workflow_save");
    if (!parent) return this.child(body, tools, serial);
    if (this.pending) {
      const value = JSON.parse(this.output(body, this.pending.call));
      this.observations.push({ tool: this.pending.name, actual_output: true });
      if (this.pending.name === "workflow_save") this.published = value;
      if (this.pending.name === "workflow_publish") {
        assert.equal(value.state, "published"); assert.match(value.definition_hash, /^[a-f0-9]{64}$/); this.published = value;
      }
      if (this.pending.name === "workflow_run") {
        assert.equal(this.mode, "execute"); assert.equal(value.run.state, "succeeded"); assert.equal(value.run.cursor, 3);
        assert.deepEqual(value.run.results.filter((v: any) => v.kind === "codex").map((v: any) => v.role_key), ["fullstack", "software-qa"]);
        assert.equal(value.execution_location, "desktop"); this.runId = value.run.id;
      }
      this.pending = null;
    }
    const name = this.actions.shift();
    if (!name) { this.mode = null; return this.message(serial, "The native workflow finished. Review the actual checklist, QA result, private SOP, executable workflow and recovery notes, and the company usage receipts."); }
    assert.ok(tools.some((tool: any) => tool.name === "copypaste." + name), "The role must expose this exact company tool");
    const call = "call_flow_" + serial; this.pending = { name, call };
    const delivered = this.actions.filter(value => value === "deliver_text").length;
    const args = name === "workflow_save" ? { name: "Native launch review", definition: this.definition }
      : name === "workflow_publish" ? { workflow_id: this.published.workflow_id, expected_version: this.published.version }
      : name === "workflow_run" ? { workflow_id: this.published.workflow_id, version: this.published.version, definition_hash: this.published.definition_hash }
      : delivered === 2 ? { filename: "SOP.md", mime_type: "text/markdown", content: "# Native launch review\nCreate the local checklist, obtain human approval and verify it with the native QA specialist.\n" }
      : delivered === 1 ? { filename: "workflow.json", mime_type: "application/json", content: JSON.stringify(this.definition, null, 2) }
      : { filename: "recovery.md", mime_type: "text/markdown", content: "# Recovery\nStop prevents later steps. Review local files and company usage after an unknown outcome. Never replay an accepted unknown step automatically.\n" };
    return { type: "function_call", id: "fc_flow_" + serial, call_id: call, namespace: "copypaste", name, arguments: JSON.stringify(args) };
  }
  private child(body: any, tools: any[], serial: number) {
    const user = [...body.input].reverse().find((entry: any) => entry.role === "user");
    const text = JSON.stringify(user ?? body.input);
    const key = text.includes("NATIVE_FLOW_QA:") ? "qa" : text.includes("NATIVE_FLOW_FIRST:") ? "first"
      : text.includes("NATIVE_FLOW_STOP:") ? "stop" : text.includes("NATIVE_FLOW_REVOKE:") ? "revoke" : null;
    assert.ok(key, "Every child must contain its server-frozen role step prompt");
    const previous = this.children.get(key);
    if (previous) {
      const output = this.output(body, previous.call);
      if (previous.stage === "command" && ["first", "qa"].includes(key)) {
        assert.ok(output.includes(key === "first" ? "NATIVE_FLOW_FIRST_DONE" : "NATIVE_FLOW_QA_DONE"), "The native shell must really return the file result");
        this.observations.push({ tool: "native_command_" + key, actual_output: true }); previous.stage = "done";
        return this.message(serial, key === "first" ? "Native checklist and full-access marker verified." : "Native QA read and verified the real checklist.");
      }
      assert.notEqual(previous.stage, "question", "The harness must stop or revoke; it must never submit this synthetic waiting question");
      const tool = tools.find((v: any) => /(?:^|\.)request_user_input$/.test(v.name)); assert.ok(tool);
      previous.call = "call_flow_wait_" + serial; previous.stage = "question";
      return { type: "function_call", id: "fc_flow_wait_" + serial, call_id: previous.call, name: tool.name,
        arguments: JSON.stringify({ questions: [{ id: "hold", header: "Native child", question: "Keep this explicitly synthetic native cancellation check running?",
          options: [{ label: "Continue", description: "Keep the bounded command alive." }, { label: "Stop", description: "Use the application's Stop control." }] }] }) };
    }
    const q = (v: string) => "'" + v.replaceAll("'", "''") + "'";
    const checklist = path.join(this.workspace, "native-flow-checklist.txt"), qa = path.join(this.workspace, "native-flow-qa.txt");
    const cmd = key === "first" ? `[IO.File]::WriteAllText(${q(checklist)}, 'native-checklist-verified'); [IO.File]::WriteAllText(${q(this.outside)}, 'native-child-full-access'); [Console]::WriteLine('NATIVE_FLOW_FIRST_DONE')`
      : key === "qa" ? `if ([IO.File]::ReadAllText(${q(checklist)}) -ne 'native-checklist-verified') { throw 'Checklist mismatch' }; [IO.File]::WriteAllText(${q(qa)}, [IO.File]::ReadAllText(${q(checklist)}) + '-qa'); [Console]::WriteLine('NATIVE_FLOW_QA_DONE')`
      : `[IO.File]::WriteAllText(${q(path.join(this.workspace, "native-flow-" + key + "-started.txt"))}, 'started'); Start-Sleep -Seconds 8; [IO.File]::WriteAllText(${q(path.join(this.workspace, "native-flow-" + key + "-forbidden.txt"))}, 'MUST_NOT_EXIST')`;
    const tool = tools.find((v: any) => /(?:^|\.)(exec_command|shell|shell_command)$/.test(v.name)); assert.ok(tool);
    const args = tool.parameters?.properties?.cmd ? { cmd, workdir: this.workspace, yield_time_ms: 1000, max_output_tokens: 1000 }
      : tool.parameters?.properties?.command?.type === "array" ? { command: ["powershell.exe", "-NoProfile", "-Command", cmd], workdir: this.workspace, timeout_ms: 1000 }
      : { command: cmd, workdir: this.workspace, timeout_ms: 1000 };
    const call = "call_flow_cmd_" + serial; this.children.set(key, { call, stage: "command" });
    return { type: "function_call", id: "fc_flow_cmd_" + serial, call_id: call, name: tool.name, arguments: JSON.stringify(args) };
  }
  private message(serial: number, text: string) {
    return { type: "message", id: "msg_flow_" + serial, role: "assistant", status: "completed", content: [{ type: "output_text", annotations: [], text }] };
  }
}
