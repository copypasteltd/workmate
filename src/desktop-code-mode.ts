import { cloudExecGrammar } from "./cloud-tool-contract.js";
import type { DesktopCompanyToolSchema } from "./desktop-tool-policy.js";

/** The pinned native runtime advertises code mode for recognized GPT models.
 * The wrapper runs on the customer's device; it grants no company RPC rights.
 * Server-issued registrations and existing handlers remain authoritative. */
export function desktopCodeModeDeclarations(
  body: Record<string, any>,
  allowed: readonly string[],
  company: readonly DesktopCompanyToolSchema[],
) {
  let programmatic = false, wait = false, bundles = 0;
  const deny = (): never => { throw new Error("AI_DESKTOP_TOOL_NOT_ALLOWED"); };
  const collaboration = new Set(["followup_task", "interrupt_agent", "list_agents", "send_message", "spawn_agent", "wait_agent"]);
  const input = Array.isArray(body.input) ? body.input.map((item: any) => {
    if (item?.type !== "additional_tools") return item;
    if (++bundles > 1 || !Array.isArray(item.tools)) deny();
    const namespaces = new Set<string>();
    const tools = item.tools.flatMap((namespace: any) => {
      if (namespace?.type !== "namespace" || namespaces.has(namespace.name) || !Array.isArray(namespace.tools)) deny();
      namespaces.add(namespace.name);
      if (namespace.name === "collaboration" || namespace.name === "clock") {
        const names = namespace.name === "clock" ? new Set(["sleep"]) : collaboration;
        if (!namespace.tools.every((t: any) => t?.type === "function" && names.has(t.name))) deny();
        // These wrappers have no independent company task authorization.
        return [];
      }
      if (namespace.name !== "functions") deny();
      const seen = new Set<string>();
      const children = namespace.tools.flatMap((tool: any) => {
        if (!tool || typeof tool.name !== "string" || seen.has(tool.name)) deny();
        seen.add(tool.name);
        if (["request_user_input", "request_user_input_async"].includes(tool.name)) {
          if (tool.type !== "function") deny();
          return []; // Use the already registered client input/company tools.
        }
        if (tool.name === "exec") {
          if (tool.type !== "custom" || tool.format?.type !== "grammar" || tool.format.syntax !== "lark" || tool.format.definition?.trim() !== cloudExecGrammar.trim()) deny();
          programmatic = true;
          return [{ ...tool, description: [
            "Run JavaScript in the customer's native Codex V8 tool orchestrator. Use await and text(result). No Node.js, filesystem or network globals; operations use registered tools.",
            "Local files and terminal require the customer's active native permission. tools.exec_command({cmd,workdir,max_output_tokens,yield_time_ms}) runs a local command; tools.write_stdin({session_id,chars,yield_time_ms,max_output_tokens}) continues it.",
            "Available names under the current server task: " + JSON.stringify(allowed),
            "Company tool namespace separators become two underscores: copypaste.asset_text_read is tools.copypaste__asset_text_read. Their original server validators and task permissions remain mandatory: " + JSON.stringify(company),
            "Do not invoke delegation, unregistered control tools or virtualization. Resume a yielded cell only through functions.wait.",
          ].join("\n") }];
        }
        if (tool.name === "wait") {
          const p = tool.parameters;
          if (tool.type !== "function" || p?.type !== "object" || p.properties?.cell_id?.type !== "string" || !Array.isArray(p.required) || !p.required.includes("cell_id") || Object.keys(p.properties).some(k => !["cell_id", "max_tokens", "yield_time_ms", "terminate"].includes(k))) deny();
          wait = true;
          return [tool];
        }
        deny();
      });
      return children.length ? [{ ...namespace, tools: children }] : [];
    });
    return { ...item, tools };
  }) : body.input;
  if (wait && !programmatic) deny();
  return { body: { ...body, ...(input === undefined ? {} : { input }) }, programmatic, wait };
}
