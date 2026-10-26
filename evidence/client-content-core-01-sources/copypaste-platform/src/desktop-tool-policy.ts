import { canonical } from "./lib.js";
import { browserNamespace, browserToolDefinitions } from "./browser-contract.js";
import { programNamespace, programToolDefinitions } from "./program-contract.js";

export interface DesktopCompanyToolSchema { name: string; inputSchema: unknown }

/** Wire projection observed against the pinned native runtime. Codex serializes
 * only its supported schema structure, omits validation annotations and turns
 * const into a singleton enum. Business tools still validate the original Zod
 * schema before effects. Never normalize a caller's declaration before comparing. */
export function desktopCompanyToolSchema(schema: unknown): unknown {
  if (typeof schema === "boolean") return schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Invalid trusted company schema");
  const result: Record<string, unknown> = {};
  const omitted = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "default"]);
  for (const [key, value] of Object.entries(schema)) {
    if (omitted.has(key)) continue;
    if (key === "const") { result.enum = [value]; continue; }
    if (["type", "description", "enum", "required"].includes(key)) result[key] = value;
    else if (key === "properties") result[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, desktopCompanyToolSchema(child)]));
    else if (key === "items" || key === "additionalProperties") result[key] = desktopCompanyToolSchema(value);
    else if (["oneOf", "anyOf"].includes(key) && Array.isArray(value)) result[key] = value.map(desktopCompanyToolSchema);
    else throw new Error("Unsupported trusted native company schema keyword");
  }
  return result;
}

/** Native tools have a separate contract from cloud business tools. OS access
 * remains controlled by the customer's local permission grant and sandbox. */
const functions = new Set([
  "exec_command", "shell", "shell_command", "write_stdin", "update_plan",
  "view_image", "request_user_input", "sleep", "curr_time",
  "get_goal", "create_goal", "update_goal",
]);
const custom = new Set(["apply_patch"]);
export const desktopToolNames = [
  ...[...functions, ...custom].flatMap(name => [name, "functions." + name]),
  ...browserToolDefinitions.map(tool => browserNamespace + "." + tool.name),
  ...programToolDefinitions.map(tool => programNamespace + "." + tool.name),
];

export function desktopToolDeclarations(tools: unknown[], company: readonly DesktopCompanyToolSchema[] = []): boolean {
  if (tools.length > 32) return false;
  const seen = new Set<string>();
  const check = (tool: any, prefix = ""): boolean => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    if (tool.type === "namespace")
      return !prefix && ["functions", "copypaste", browserNamespace, programNamespace].includes(tool.name) && Array.isArray(tool.tools) && tool.tools.length <= 32
        && tool.tools.every((child: unknown) => check(child, tool.name + "."));
    if (typeof tool.name !== "string" || seen.has(prefix + tool.name)) return false;
    seen.add(prefix + tool.name);
    if (prefix === browserNamespace + "." || prefix === programNamespace + ".") {
      const registered = (prefix === browserNamespace + "." ? browserToolDefinitions : programToolDefinitions).find(item => item.name === tool.name);
      return tool.type === "function" && !!registered && tool.parameters !== null && typeof tool.parameters === "object"
        && !Array.isArray(tool.parameters) && canonical(tool.parameters) === canonical(desktopCompanyToolSchema(registered.inputSchema));
    }
    if (prefix === "copypaste.") {
      const registered = company.find(item => item.name === tool.name);
      return tool.type === "function" && !!registered && tool.parameters !== null && typeof tool.parameters === "object"
        && !Array.isArray(tool.parameters) && canonical(tool.parameters) === canonical(registered.inputSchema);
    }
    if (tool.type === "function") return functions.has(tool.name)
      && typeof tool.parameters === "object" && tool.parameters !== null && !Array.isArray(tool.parameters);
    return tool.type === "custom" && custom.has(tool.name)
      && tool.format?.type === "grammar" && tool.format?.syntax === "lark" && typeof tool.format?.definition === "string"
      && tool.format.definition.length <= 200000;
  };
  return tools.every(tool => check(tool));
}

export function desktopCustomTool(name: unknown) {
  return typeof name === "string" && custom.has(name.replace(/^functions\./, ""));
}
