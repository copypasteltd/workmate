import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { Problem } from "./lib.js";
const exec = promisify(execFile);
export interface RuntimeContext {
  taskId: string;
  prompt: string;
  workspace: string;
  skills: { key: string; content: string }[];
  thread?: string;
  signal: AbortSignal;
  onEvent: (kind: string, body: any) => Promise<void>;
  tools: {
    name: string;
    description: string;
    inputSchema: unknown;
    run: (args: unknown, callId: string) => Promise<unknown>;
  }[];
}
export interface RuntimeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  usageKnown: boolean;
  accepted: boolean;
  thread: string;
  turn: string;
  status: string;
}
export class RuntimeFailure extends Error {
  constructor(
    public code: string,
    public accepted: boolean,
    public usageKnown: boolean,
    public inputTokens = 0,
    public outputTokens = 0,
  ) {
    super(code);
  }
}
export class CodexRuntimeAdapter {
  constructor(private c: Config) {}
  async version() {
    const { stdout } = await exec(this.c.CODEX_BIN, ["--version"], {
      timeout: 10_000,
      windowsHide: true,
    });
    const v = stdout.trim().replace(/^codex-cli\s+/, "");
    if (v !== this.c.CODEX_VERSION)
      throw new Problem(
        503,
        "CODEX_VERSION_MISMATCH",
        "Installed Codex version does not match the locked runtime profile",
      );
    return v;
  }
  async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    if (ctx.signal.aborted)
      throw new RuntimeFailure("CODEX_CANCELLED", false, true);
    await this.version();
    if (ctx.signal.aborted)
      throw new RuntimeFailure("CODEX_CANCELLED", false, true);
    if (
      !this.c.AI_BASE_URL ||
      !this.c.AI_MODEL ||
      !this.c.AI_API_KEY ||
      !this.c.AI_VERIFIED
    )
      throw new RuntimeFailure("AI_SETUP_REQUIRED", false, true);
    await mkdir(ctx.workspace, { recursive: true });
    const home = path.join(ctx.workspace, ".codex");
    await mkdir(home, { recursive: true });
    const skills = [];
    for (const s of ctx.skills) {
      const file = path.join(
        ctx.workspace,
        ".agents",
        "skills",
        s.key,
        "SKILL.md",
      );
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, s.content);
      skills.push({ type: "skill", name: s.key, path: file });
    }
    const quote = (s: string) => JSON.stringify(s);
    const config = [
      `model = ${quote(this.c.AI_MODEL)}`,
      'model_provider = "copypaste_internal"',
      `model_reasoning_effort = ${quote(this.c.AI_REASONING_EFFORT)}`,
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      'web_search = "disabled"',
      "[model_providers.copypaste_internal]",
      'name = "CopyPaste Internal Gateway"',
      `base_url = ${quote(this.c.AI_BASE_URL)}`,
      'env_key = "COPYPASTE_RUNTIME_KEY"',
      'wire_api = "responses"',
      "request_max_retries = 0",
      "stream_max_retries = 0",
      "[features]",
      "shell_tool = false",
      "multi_agent = false",
      "[analytics]",
      "enabled = false",
    ].join("\n");
    await writeFile(path.join(home, "config.toml"), config);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: ctx.workspace,
      USERPROFILE: ctx.workspace,
      CODEX_HOME: home,
      COPYPASTE_RUNTIME_KEY: this.c.AI_API_KEY,
    };
    const child = spawn(
      this.c.CODEX_BIN,
      ["app-server", "--stdio", "--strict-config"],
      {
        cwd: ctx.workspace,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    // Register before any RPC: exit can precede pipe closure on Windows.
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    const lines = createInterface({ input: child.stdout });
    let seq = 0,
      accepted = false,
      thread = "",
      turn = "",
      text = "",
      input = 0,
      output = 0,
      usageKnown = false;
    const pending = new Map<
      number,
      {
        resolve: (v: any) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    const send = (method: string, params: unknown) =>
      new Promise<any>((resolve, reject) => {
        if (ctx.signal.aborted && method !== "turn/interrupt") {
          reject(
            new RuntimeFailure(
              "CODEX_CANCELLED",
              accepted,
              usageKnown,
              input,
              output,
            ),
          );
          return;
        }
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new RuntimeFailure(
              "CODEX_RPC_TIMEOUT",
              accepted,
              usageKnown,
              input,
              output,
            ),
          );
        }, 60_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    let finish!: (v: string) => void;
    const done = new Promise<string>((r) => {
      finish = r;
    });
    const onLine = async (line: string) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id !== undefined && (m.result !== undefined || m.error)) {
        const p = pending.get(m.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(m.id);
          if (m.error)
            p.reject(
              new RuntimeFailure(
                "CODEX_RPC_REJECTED",
                accepted,
                usageKnown,
                input,
                output,
              ),
            );
          else p.resolve(m.result);
        }
        return;
      }
      if (m.id !== undefined && m.method) {
        if (m.method === "item/tool/call") {
          const tool = ctx.tools.find((t) => t.name === m.params?.tool);
          let result: any;
          try {
            if (!tool || ctx.signal.aborted)
              throw new Error("Tool not allowed");
            result = {
              success: true,
              contentItems: [
                {
                  type: "inputText",
                  text: JSON.stringify(
                    await tool.run(m.params.arguments, m.params.callId),
                  ),
                },
              ],
            };
          } catch {
            result = {
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text: "Tool execution failed or permission denied. Do not fabricate a result.",
                },
              ],
            };
          }
          child.stdin.write(JSON.stringify({ id: m.id, result }) + "\n");
        } else
          child.stdin.write(
            JSON.stringify({ id: m.id, result: { decision: "decline" } }) +
              "\n",
          );
        return;
      }
      if (m.method === "item/agentMessage/delta") {
        const delta = String(m.params?.delta ?? "");
        text += delta;
        await ctx.onEvent("message.delta", { text: delta });
      }
      if (m.method === "thread/tokenUsage/updated") {
        const u = m.params?.tokenUsage?.total;
        if (u) {
          input = Number(u.inputTokens);
          output = Number(u.outputTokens);
          usageKnown =
            Number.isSafeInteger(input) && Number.isSafeInteger(output);
        }
      }
      if (m.method === "turn/completed")
        finish(m.params?.turn?.status ?? "failed");
      if (m.method === "error" && m.params?.willRetry === false)
        finish("failed");
    };
    let chain = Promise.resolve();
    lines.on("line", (l) => {
      chain = chain.then(() => onLine(l)).catch(() => finish("failed"));
    });
    child.stderr.on("data", () => {
      /* Raw runtime stderr can contain sensitive input; do not log it. */
    });
    const failPending = (code = "CODEX_CONNECTION_LOST") => {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new RuntimeFailure(code, accepted, usageKnown, input, output));
      }
      pending.clear();
    };
    child.on("error", () => {
      failPending();
      finish("process_error");
    });
    child.on("exit", () => {
      failPending();
      finish("process_exit");
    });
    child.stdin.on("error", () => {
      failPending();
      finish("process_error");
    });
    let interruptTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (!turn) {
        failPending("CODEX_CANCELLED");
        finish("interrupted");
        child.kill();
        return;
      }
      if (thread && turn)
        void send("turn/interrupt", { threadId: thread, turnId: turn }).catch(
          () => {},
        );
      interruptTimer ??= setTimeout(() => {
        failPending("CODEX_CANCELLED");
        finish("interrupted");
        child.kill();
      }, 15000);
    };
    ctx.signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => {
      abort();
      failPending("CODEX_RPC_TIMEOUT");
      finish("timeout");
    }, 15 * 60_000);
    if (ctx.signal.aborted) abort();
    try {
      await ctx.onEvent("runtime.phase", { phase: "initialize" });
      await send("initialize", {
        clientInfo: {
          name: "copypaste_enterprise",
          title: "CopyPaste",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
      const common = {
        model: this.c.AI_MODEL,
        modelProvider: "copypaste_internal",
        cwd: ctx.workspace,
        approvalPolicy: "never",
        sandbox: "read-only",
        allowProviderModelFallback: false,
        developerInstructions:
          "You are a CopyPaste enterprise specialist. Use only the registered tools, bound Skills and current project data. No shell, arbitrary network, secrets, local virtualization, unsupported claims or fabricated artifacts. Deliver editable sources and report unresolved requirements.",
        dynamicTools: ctx.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
      const result = await send(
        ctx.thread ? "thread/resume" : "thread/start",
        ctx.thread ? { ...common, threadId: ctx.thread } : common,
      );
      thread = result.thread.id;
      await ctx.onEvent("runtime.thread", { thread_id: thread });
      accepted = true; // A lost turn/start response is uncertain and must not release the reservation.
      const t = await send("turn/start", {
        threadId: thread,
        model: this.c.AI_MODEL,
        effort: this.c.AI_REASONING_EFFORT,
        input: [...skills, { type: "text", text: ctx.prompt }],
      });
      turn = t.turn.id;
      await ctx.onEvent("runtime.turn", { thread_id: thread, turn_id: turn });
      if (ctx.signal.aborted) abort();
      const status = await done;
      await ctx.onEvent("runtime.phase", { phase: "finished", status });
      await chain;
      if (["timeout", "process_exit", "process_error"].includes(status))
        throw new RuntimeFailure(
          "CODEX_CONNECTION_LOST",
          accepted,
          usageKnown,
          input,
          output,
        );
      return {
        text,
        inputTokens: input,
        outputTokens: output,
        usageKnown,
        accepted,
        thread,
        turn,
        status,
      };
    } catch (e) {
      if (e instanceof RuntimeFailure) throw e;
      throw new RuntimeFailure(
        "CODEX_RUNTIME_FAILED",
        accepted,
        usageKnown,
        input,
        output,
      );
    } finally {
      await ctx.onEvent("runtime.phase", { phase: "cleanup" }).catch(() => {});
      clearTimeout(deadline);
      if (interruptTimer) clearTimeout(interruptTimer);
      ctx.signal.removeEventListener("abort", abort);
      lines.close();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Runtime stopped"));
      }
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            cleanupTimer = setTimeout(
              () =>
                reject(
                  new RuntimeFailure(
                    "CODEX_CLEANUP_FAILED",
                    accepted,
                    usageKnown,
                    input,
                    output,
                  ),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        if (cleanupTimer) clearTimeout(cleanupTimer);
      }
      await ctx.onEvent("runtime.phase", { phase: "closed" }).catch(() => {});
    }
  }
}
