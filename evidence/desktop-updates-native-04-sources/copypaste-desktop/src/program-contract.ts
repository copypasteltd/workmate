/** Native-only, versioned contract; keep identical in Desktop and Platform. */
export const programToolsVersion = 1 as const;
export const programNamespace = "copypaste_programs";
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
export const programToolDefinitions = [
  { name: "list", description: "List programs explicitly approved by this customer for the current local session and permission version. Requires full local access. A missing program must be chosen by the customer in the trusted Desktop UI.", inputSchema: object({}, []) },
  { name: "run", description: "Run an approved program ID on this customer's device with a structured argv array, without shell expansion. Uses the current local task and workspace. Requires current full local access. Output reports actual exit status; nonzero, timeout and unknown are not success. Never repeat an unknown invocation with a new call ID. No executable path or environment overrides are accepted.", inputSchema: object({ program_id: { type: "string" }, argv: { type: "array", items: { type: "string" } }, timeout_ms: { type: "number" } }, ["program_id", "argv"]) },
  { name: "status", description: "Read the original program receipt belonging to this local task. Does not launch or repeat any process. Unknown outcomes require customer review.", inputSchema: object({ receipt_id: { type: "string" } }, ["receipt_id"]) },
] as const;
export interface ProgramToolCall { namespace: typeof programNamespace; tool: string; arguments: Record<string, unknown>; callId: string; threadId: string; turnId: string }
export interface ProgramToolResult { success: boolean; contentItems: { type: "inputText"; text: string }[] }
export interface LocalProgramSession { call(call: ProgramToolCall, signal: AbortSignal): Promise<ProgramToolResult>; close(): Promise<void> }
export class LocalProgramError extends Error {
  constructor(public readonly code: string, public readonly recoverable = true) { super(code); }
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function validateProgramCall(call: ProgramToolCall) {
  const definition = programToolDefinitions.find(tool => tool.name === call?.tool), args = call?.arguments;
  if (!definition || call.namespace !== programNamespace || typeof call.callId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(call.callId)
    || typeof call.threadId !== "string" || !call.threadId || call.threadId.length > 200
    || typeof call.turnId !== "string" || !call.turnId || call.turnId.length > 200
    || !args || typeof args !== "object" || Array.isArray(args)) throw new LocalProgramError("LOCAL_PROGRAM_INPUT_INVALID");
  const properties = definition.inputSchema.properties;
  if (Object.keys(args).some(key => !Object.hasOwn(properties, key)) || definition.inputSchema.required.some(key => !Object.hasOwn(args, key))) throw new LocalProgramError("LOCAL_PROGRAM_INPUT_INVALID");
  if (call.tool === "run" && (typeof args.program_id !== "string" || !uuid.test(args.program_id) || !Array.isArray(args.argv) || args.argv.length > 64
    || args.argv.some(arg => typeof arg !== "string" || arg.includes("\0") || arg.length > 4096)
    || Buffer.byteLength(JSON.stringify(args.argv)) > 32768
    || (args.timeout_ms !== undefined && (!Number.isSafeInteger(args.timeout_ms) || Number(args.timeout_ms) < 100 || Number(args.timeout_ms) > 120000)))) throw new LocalProgramError("LOCAL_PROGRAM_INPUT_INVALID");
  if (call.tool === "status" && (typeof args.receipt_id !== "string" || !uuid.test(args.receipt_id))) throw new LocalProgramError("LOCAL_PROGRAM_INPUT_INVALID");
}
