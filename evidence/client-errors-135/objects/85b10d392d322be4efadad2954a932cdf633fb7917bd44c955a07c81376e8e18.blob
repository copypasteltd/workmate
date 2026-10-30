import { createHash } from "node:crypto";
import { browserNamespace, BrowserToolError, validateBrowserArguments, type BrowserToolCall, type BrowserToolResult, type LocalBrowserSession } from "./browser-contract.js";

export interface BrowserDriver {
  execute(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<BrowserToolResult>;
  close(): Promise<void>;
}
const canonical = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
    : "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
  : JSON.stringify(value);

/** The ledger binds native call IDs before effects. It is deliberately not
 * restored after a crash: a running native checkpoint already requires manual
 * reconciliation and may never replay previously accepted browser operations. */
export class GuardedBrowserSession implements LocalBrowserSession {
  private shutdown = new AbortController();
  private closing?: Promise<void>;
  private calls = new Map<string, { digest: string; result: Promise<BrowserToolResult> }>();
  private bytes = 0;
  constructor(private driver: BrowserDriver, private authorize: () => Promise<void>) {}

  async call(call: BrowserToolCall, signal: AbortSignal) {
    if (signal.aborted) { await this.close(); throw new BrowserToolError("BROWSER_INTERRUPTED", false); }
    const stop = () => { void this.close().catch(() => {}); };
    signal.addEventListener("abort", stop, { once: true });
    try { return await this.execute(call, signal); }
    finally { signal.removeEventListener("abort", stop); }
  }
  private async execute(call: BrowserToolCall, signal: AbortSignal) {
    const active = AbortSignal.any([signal, this.shutdown.signal]);
    const check = async () => {
      if (active.aborted) throw new BrowserToolError("BROWSER_INTERRUPTED", false);
      await this.authorize();
      if (active.aborted) throw new BrowserToolError("BROWSER_INTERRUPTED", false);
    };
    await check();
    if (call.namespace !== browserNamespace || !/^[A-Za-z0-9_.:-]{1,128}$/.test(call.callId)
      || !call.threadId || !call.turnId) throw new BrowserToolError("BROWSER_CALL_SCOPE_INVALID", false);
    validateBrowserArguments(call.tool, call.arguments);
    const digest = createHash("sha256").update(canonical(call)).digest("hex");
    const previous = this.calls.get(call.callId);
    if (previous) {
      if (previous.digest !== digest) throw new BrowserToolError("BROWSER_CALL_ID_CONFLICT", false);
      const output = await previous.result; await check(); return structuredClone(output);
    }
    if (this.calls.size >= 128 || this.bytes > 28_000_000) throw new BrowserToolError("BROWSER_CALL_LIMIT");
    const result = (async () => {
      await check();
      const output = await this.driver.execute(call.tool, structuredClone(call.arguments), active);
      await check();
      const encoded = JSON.stringify(output);
      if (Buffer.byteLength(encoded) > 4_000_000) throw new BrowserToolError("BROWSER_RESULT_LIMIT", false);
      this.bytes += Buffer.byteLength(encoded);
      return structuredClone(output);
    })();
    // Stored before the first effect is awaited, including rejected outcomes.
    this.calls.set(call.callId, { digest, result });
    return structuredClone(await result);
  }
  close(): Promise<void> {
    this.shutdown.abort();
    return this.closing ??= this.driver.close();
  }
}
