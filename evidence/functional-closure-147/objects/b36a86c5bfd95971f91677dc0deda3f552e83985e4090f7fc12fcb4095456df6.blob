import { canonical } from "./lib.js";
import {
  browserNamespace,
  browserToolDefinitions,
} from "./browser-contract.js";
import {
  programNamespace,
  programToolDefinitions,
} from "./program-contract.js";

export interface DesktopCompanyToolSchema {
  name: string;
  inputSchema: unknown;
}

/** Project only trusted registrations to the pinned native runtime's wire form.
 * Native schema compaction is part of that contract, not caller permission.
 * The original business validators remain mandatory before all effects. */
function nativeSchema(schema: unknown): unknown {
  if (typeof schema === "boolean") return schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new Error("Invalid trusted company schema");
  const result: Record<string, unknown> = {};
  const omitted = new Set([
    "$schema",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    // Property-name patterns constrain business input names on the server.
    // The pinned native tool wire schema keeps the typed additionalProperties
    // and omits this unsupported presentation keyword, like scalar patterns.
    "propertyNames",
    "format",
    "maxItems",
    "default",
  ]);
  for (const [key, value] of Object.entries(schema)) {
    if (omitted.has(key)) continue;
    if (key === "const") {
      result.enum = [value];
      continue;
    }
    if (["type", "description", "enum", "required", "minItems"].includes(key))
      result[key] = value;
    else if (key === "properties")
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([name, child]) => [name, nativeSchema(child)],
        ),
      );
    else if (key === "items" || key === "additionalProperties")
      result[key] = nativeSchema(value);
    else if (["oneOf", "anyOf"].includes(key) && Array.isArray(value))
      result[key] = value.map(nativeSchema);
    else throw new Error("Unsupported trusted native company schema keyword");
  }
  return result;
}

/** Verified against actual 0.163.0-alpha.11 requests and its tagged source:
 * codex-rs/tools/src/json_schema/compaction.rs. The registered subset rejects
 * definitions/references, so its definition-removal pass has no effect here.
 * Never apply this projection to untrusted declarations before comparison. */
export function desktopCompanyToolSchema(schema: unknown): unknown {
  const children = ["items", "additionalProperties", "oneOf", "anyOf"];
  const visit = (
    value: any,
    fn: (node: any, depth: number) => boolean,
    depth = 0,
  ): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, fn, depth);
      return;
    }
    if (!fn(value, depth)) return;
    for (const child of Object.values(value.properties ?? {}))
      visit(child, fn, depth + 1);
    for (const key of children)
      if (key in value) visit(value[key], fn, depth + 1);
  };
  const result = nativeSchema(schema);
  const fits = () => Buffer.byteLength(JSON.stringify(result), "utf8") <= 5000;
  if (fits()) return result;
  visit(result, (node) => {
    delete node.description;
    return true;
  });
  if (fits()) return result;
  const clear = (node: any) => {
    for (const key of Object.keys(node)) delete node[key];
  };
  visit(result, (node, depth) => {
    if (depth >= 3 && ["properties", ...children].some((key) => key in node)) {
      clear(node);
      return false;
    }
    return true;
  });
  if (fits()) return result;
  visit(result, (node) => {
    if ("oneOf" in node || "anyOf" in node) {
      clear(node);
      return false;
    }
    return true;
  });
  return result;
}

/** Native tools have a separate contract from cloud business tools. OS access
 * remains controlled by the customer's local permission grant and sandbox. */
const functions = new Set([
  "exec_command",
  "shell",
  "shell_command",
  "write_stdin",
  "update_plan",
  "view_image",
  "request_user_input",
  "sleep",
  "curr_time",
  "get_goal",
  "create_goal",
  "update_goal",
]);
const custom = new Set(["apply_patch"]);
export const desktopToolNames = [
  ...[...functions, ...custom].flatMap((name) => [name, "functions." + name]),
  ...browserToolDefinitions.map((tool) => browserNamespace + "." + tool.name),
  ...programToolDefinitions.map((tool) => programNamespace + "." + tool.name),
];

export function desktopToolDeclarations(
  tools: unknown[],
  company: readonly DesktopCompanyToolSchema[] = [],
): boolean {
  if (tools.length > 32) return false;
  const seen = new Set<string>();
  const check = (tool: any, prefix = ""): boolean => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    if (tool.type === "namespace")
      return (
        !prefix &&
        ["functions", "copypaste", browserNamespace, programNamespace].includes(
          tool.name,
        ) &&
        Array.isArray(tool.tools) &&
        tool.tools.length <= 32 &&
        tool.tools.every((child: unknown) => check(child, tool.name + "."))
      );
    if (typeof tool.name !== "string" || seen.has(prefix + tool.name))
      return false;
    seen.add(prefix + tool.name);
    if (
      prefix === browserNamespace + "." ||
      prefix === programNamespace + "."
    ) {
      const registered = (
        prefix === browserNamespace + "."
          ? browserToolDefinitions
          : programToolDefinitions
      ).find((item) => item.name === tool.name);
      return (
        tool.type === "function" &&
        !!registered &&
        tool.parameters !== null &&
        typeof tool.parameters === "object" &&
        !Array.isArray(tool.parameters) &&
        canonical(tool.parameters) ===
          canonical(desktopCompanyToolSchema(registered.inputSchema))
      );
    }
    if (prefix === "copypaste.") {
      const registered = company.find((item) => item.name === tool.name);
      return (
        tool.type === "function" &&
        !!registered &&
        tool.parameters !== null &&
        typeof tool.parameters === "object" &&
        !Array.isArray(tool.parameters) &&
        canonical(tool.parameters) === canonical(registered.inputSchema)
      );
    }
    if (tool.type === "function")
      return (
        functions.has(tool.name) &&
        typeof tool.parameters === "object" &&
        tool.parameters !== null &&
        !Array.isArray(tool.parameters)
      );
    return (
      tool.type === "custom" &&
      custom.has(tool.name) &&
      tool.format?.type === "grammar" &&
      tool.format?.syntax === "lark" &&
      typeof tool.format?.definition === "string" &&
      tool.format.definition.length <= 200000
    );
  };
  return tools.every((tool) => check(tool));
}

export function desktopCustomTool(name: unknown) {
  return (
    typeof name === "string" && custom.has(name.replace(/^functions\./, ""))
  );
}
