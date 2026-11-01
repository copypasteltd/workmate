import { canonical } from "./lib.js";
import { desktopCompanyToolSchema } from "./desktop-tool-policy.js";

export interface CloudToolRegistration {
  name: string;
  description: string;
  inputSchema: unknown;
}

// Codex 0.163.0-alpha.11 code-mode wire grammar. This is an isolated V8
// orchestrator, not the OS exec_command tool. Business effects still enter the
// registered item/tool/call bridge and its original validators/authority.
export const cloudExecGrammar = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

export class CloudToolContractError extends Error {
  constructor(readonly reason = "declaration_shape") {
    super("AI_TOOL_NOT_ALLOWED");
  }
}
const deny = (reason?: string): never => {
  throw new CloudToolContractError(reason);
};
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const strippedControls = new Set([
  "request_user_input",
  "request_user_input_async",
]);
const collaborationControls = new Set([
  "followup_task",
  "interrupt_agent",
  "list_agents",
  "send_message",
  "spawn_agent",
  "wait_agent",
]);

/** The scope is issued by the server. Never infer tool authority from a model
 * supplied declaration, description, code fragment or tool result. */
export function cloudToolDeclarations(
  body: Record<string, any>,
  allowed: readonly string[],
  registrations?: readonly CloudToolRegistration[],
) {
  let programmatic = false,
    wait = false,
    bundles = 0;
  if (body.tools !== undefined && !Array.isArray(body.tools)) deny();
  const checkFunction = (tool: any) => {
    if (
      !object(tool) ||
      tool.type !== "function" ||
      !allowed.includes(tool.name)
    )
      deny();
    const registered = registrations?.find((t) => t.name === tool.name);
    if (
      registrations &&
      (!registered ||
        canonical(tool.parameters) !==
          canonical(desktopCompanyToolSchema(registered.inputSchema)))
    )
      deny("registered_schema");
    return tool;
  };
  const tools = (body.tools ?? [])
    .filter(
      (tool: any) =>
        !(tool?.type === "function" && strippedControls.has(tool.name)),
    )
    .map(checkFunction);
  const input = Array.isArray(body.input)
    ? body.input.map((item: any) => {
        if (item?.type !== "additional_tools") return item;
        if (++bundles > 1 || !registrations || !Array.isArray(item.tools))
          deny();
        const namespaces = new Set<string>();
        const declared = item.tools.flatMap((namespace: any) => {
          if (
            !object(namespace) ||
            namespace.type !== "namespace" ||
            namespaces.has(namespace.name) ||
            !Array.isArray(namespace.tools)
          )
            deny();
          namespaces.add(namespace.name);
          // These controls have no cloud UI/tenant business handler. Native Codex
          // advertises them even with multi_agent=false; do not advertise them to
          // the provider and do not add them to response authority.
          if (namespace.name === "collaboration") {
            if (
              !namespace.tools.every(
                (t: any) =>
                  t?.type === "function" && collaborationControls.has(t.name),
              )
            )
              deny();
            return [];
          }
          if (namespace.name !== "functions") deny();
          const seen = new Set<string>();
          const children = namespace.tools.flatMap((tool: any) => {
            if (
              !object(tool) ||
              typeof tool.name !== "string" ||
              seen.has(tool.name)
            )
              deny();
            seen.add(tool.name);
            if (tool.type === "function" && strippedControls.has(tool.name))
              return [];
            if (tool.name === "exec") {
              if (
                tool.type !== "custom" ||
                tool.format?.type !== "grammar" ||
                tool.format?.syntax !== "lark" ||
                typeof tool.format?.definition !== "string" ||
                tool.format.definition.trim() !== cloudExecGrammar.trim()
              )
                deny("exec_grammar");
              programmatic = true;
              // Use only this task's trusted registrations in the model-facing
              // contract; native documentation examples are not tool permissions.
              const description = [
                "Run JavaScript in Codex's isolated V8 tool orchestrator. No Node.js, direct filesystem, network or shell access.",
                "Call only the registered tools below using await tools.NAME(arguments). Their server validators and task permissions remain mandatory.",
                "Use text(value) to return a tool result. Await all calls. If execution yields a cell ID, resume it with functions.wait.",
                "Registered tools: " + JSON.stringify(registrations),
              ].join("\n");
              return [{ ...tool, description }];
            }
            if (tool.name === "wait") {
              const schema = tool.parameters;
              if (
                tool.type !== "function" ||
                !object(schema) ||
                schema.type !== "object" ||
                !object(schema.properties) ||
                schema.properties.cell_id?.type !== "string" ||
                !Array.isArray(schema.required) ||
                !schema.required.includes("cell_id") ||
                Object.keys(schema.properties).some(
                  (k) =>
                    ![
                      "cell_id",
                      "max_tokens",
                      "yield_time_ms",
                      "terminate",
                    ].includes(k),
                )
              )
                deny("wait_schema");
              wait = true;
              return [tool];
            }
            return [checkFunction(tool)];
          });
          return children.length ? [{ ...namespace, tools: children }] : [];
        });
        return { ...item, tools: declared };
      })
    : body.input;
  if (wait && !programmatic) deny();
  return {
    body: { ...body, tools, ...(input === undefined ? {} : { input }) },
    programmatic,
    wait,
  };
}

export function cloudProgrammaticCall(
  item: any,
  contract: { programmatic: boolean; wait: boolean },
) {
  if (item.namespace != null && item.namespace !== "functions") return false;
  return (
    (contract.programmatic &&
      item.type === "custom_tool_call" &&
      item.name === "exec") ||
    (contract.wait && item.type === "function_call" && item.name === "wait")
  );
}
