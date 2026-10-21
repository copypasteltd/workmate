import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Config } from "./config.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  startScopedInferenceGateway,
  type AIRequestAuthority,
} from "./internal-ai-gateway.js";
const exec = promisify(execFile);
export interface RuntimeSelection {
  capabilityVersionId: string;
  runtimeVersion: string;
  gatewayFingerprint: string;
  dataMode: "simulated" | "configured_services";
  model: string;
  reasoningEffort: Config["AI_REASONING_EFFORT"];
  inputRate: number;
  outputRate: number;
}
export interface RuntimeContext {
  taskId: string;
  prompt: string;
  workspace: string;
  skills: { key: string; content: string }[];
  thread?: string;
  // Only the server may derive this from an immutable task capability binding.
  selection?: RuntimeSelection;
  requestAuthority?: AIRequestAuthority;
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
    const selected = ctx.selection;
    if (
      selected &&
      (!/^[a-f0-9-]{36}$/.test(selected.capabilityVersionId) ||
        selected.runtimeVersion !== this.c.CODEX_VERSION ||
        selected.gatewayFingerprint !==
          hash(
            this.c.DEMO_MODE
              ? "synthetic-local-gateway-v1"
              : (this.c.AI_BASE_URL ?? ""),
          ) ||
        selected.dataMode !==
          (this.c.DEMO_MODE ? "simulated" : "configured_services") ||
        typeof selected.model !== "string" ||
        !selected.model.length ||
        selected.model.length > 200 ||
        !["low", "medium", "high", "xhigh", "max"].includes(
          selected.reasoningEffort,
        ) ||
        ![selected.inputRate, selected.outputRate].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ))
    )
      throw new RuntimeFailure("CAPABILITY_SELECTION_INVALID", false, true);
    // Never mutate the shared adapter configuration: concurrent tasks can bind
    // different model, effort and pricing versions on the same worker.
    const c = selected
      ? {
          ...this.c,
          AI_MODEL: selected.model,
          AI_REASONING_EFFORT: selected.reasoningEffort,
          AI_INPUT_HKD_MICROS_PER_MILLION: selected.inputRate,
          AI_OUTPUT_HKD_MICROS_PER_MILLION: selected.outputRate,
          // The server issued this selection only after validating the frozen
          // binding against bootstrap verification or a published receipt.
          AI_VERIFIED: true,
        }
      : this.c;
    if (
      selected &&
      (!ctx.requestAuthority ||
        ctx.requestAuthority.taskId !== ctx.taskId ||
        ctx.requestAuthority.capabilityVersionId !==
          selected.capabilityVersionId)
    )
      throw new RuntimeFailure("AI_REQUEST_SCOPE_REQUIRED", false, true);
    if (ctx.signal.aborted)
      throw new RuntimeFailure("CODEX_CANCELLED", false, true);
    await this.version();
    if (ctx.signal.aborted)
      throw new RuntimeFailure("CODEX_CANCELLED", false, true);
    if (!c.AI_BASE_URL || !c.AI_MODEL || !c.AI_API_KEY || !c.AI_VERIFIED)
      throw new RuntimeFailure("AI_SETUP_REQUIRED", false, true);
    await mkdir(ctx.workspace, { recursive: true });
    const home = path.join(ctx.workspace, ".codex");
    await mkdir(home, { recursive: true });
    // This is a server-owned continuation receipt, not user-supplied history.
    // An accepted/unknown turn invalidates it before any further provider work.
    const receiptPath = path.join(home, "copypaste-continuation.json");
    const fingerprint = hash(
      canonical({
        version: c.CODEX_VERSION,
        ...(selected
          ? { capabilityVersionId: selected.capabilityVersionId }
          : {}),
        provider: "copypaste_internal",
        model: c.AI_MODEL,
        endpoint: c.AI_BASE_URL,
        inputRate: c.AI_INPUT_HKD_MICROS_PER_MILLION,
        outputRate: c.AI_OUTPUT_HKD_MICROS_PER_MILLION,
        effort: c.AI_REASONING_EFFORT,
        task: ctx.taskId,
        skills: ctx.skills,
        tools: ctx.tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      }),
    );
    let receipt: any;
    try {
      receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
        throw new RuntimeFailure("CODEX_CHECKPOINT_INVALID", false, true);
    } catch (e: any) {
      if (e.code !== "ENOENT")
        throw new RuntimeFailure("CODEX_CHECKPOINT_INVALID", false, true);
    }
    if (
      ctx.thread &&
      (!receipt ||
        receipt.state !== "ready" ||
        receipt.thread !== ctx.thread ||
        receipt.fingerprint !== fingerprint ||
        !Number.isSafeInteger(receipt.inputTokens) ||
        receipt.inputTokens < 0 ||
        !Number.isSafeInteger(receipt.outputTokens) ||
        receipt.outputTokens < 0)
    )
      throw new RuntimeFailure("CODEX_CHECKPOINT_UNAVAILABLE", false, true);
    if (!ctx.thread && receipt)
      throw new RuntimeFailure("CODEX_CONTINUATION_REQUIRED", false, true);
    const baselineInput = receipt?.inputTokens ?? 0,
      baselineOutput = receipt?.outputTokens ?? 0;
    const saveReceipt = async (data: unknown) => {
      const temporary = receiptPath + "." + randomUUID() + ".tmp";
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, receiptPath);
    };
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
    const gateway = await startScopedInferenceGateway(c, {
      model: c.AI_MODEL,
      reasoningEffort: c.AI_REASONING_EFFORT,
      tools: ctx.tools.map((tool) => tool.name),
      authority: ctx.requestAuthority ?? {
        taskId: ctx.taskId,
        authorize: async () => {},
      },
      signal: ctx.signal,
      onRejected: (body) => ctx.onEvent("gateway.request_rejected", body),
    });
    try {
      const quote = (s: string) => JSON.stringify(s);
      const config = [
        `model = ${quote(c.AI_MODEL)}`,
        'model_provider = "copypaste_internal"',
        `model_reasoning_effort = ${quote(c.AI_REASONING_EFFORT)}`,
        'approval_policy = "never"',
        'sandbox_mode = "read-only"',
        'web_search = "disabled"',
        "[model_providers.copypaste_internal]",
        'name = "CopyPaste Internal Gateway"',
        `base_url = ${quote(gateway.baseURL)}`,
        'env_key = "COPYPASTE_RUNTIME_KEY"',
        'wire_api = "responses"',
        "request_max_retries = 0",
        "stream_max_retries = 0",
        "supports_websockets = false",
        "[features]",
        "shell_tool = false",
        "multi_agent = false",
        "goals = false",
        "view_image = false",
        "image_generation = false",
        "computer_use = false",
        "browser_use = false",
        "browser_use_external = false",
        "apps = false",
        "plugins = false",
        "remote_plugin = false",
        "skill_mcp_dependency_install = false",
        "skill_search = false",
        "workspace_dependencies = false",
        "sleep_tool = false",
        "tool_suggest = false",
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
        COPYPASTE_RUNTIME_KEY: gateway.credential,
      };
      const child = spawn(
        c.CODEX_BIN,
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
      let hasExited = false;
      const exited = new Promise<void>((resolve) => {
        const finishExit = () => {
          hasExited = true;
          resolve();
        };
        child.once("exit", finishExit);
        child.once("error", finishExit);
      });
      const waitForExit = async (ms: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            exited,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, ms);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        return hasExited;
      };
      const lines = createInterface({ input: child.stdout });
      let seq = 0,
        accepted = false,
        thread = "",
        turn = "",
        text = "",
        input = 0,
        output = 0,
        usageKnown = false;
      let threadInput = baselineInput,
        threadOutput = baselineOutput;
      let completedResult: RuntimeResult | undefined;
      let invalidUsage = false;
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
          // Resume may emit the previous turn's usage. It is not new spend.
          if (
            u &&
            turn &&
            m.params?.threadId === thread &&
            m.params?.turnId === turn
          ) {
            const nextInput = Number(u.inputTokens),
              nextOutput = Number(u.outputTokens);
            if (
              !Number.isSafeInteger(nextInput) ||
              !Number.isSafeInteger(nextOutput) ||
              nextInput < threadInput ||
              nextOutput < threadOutput
            ) {
              invalidUsage = true;
              usageKnown = false;
              return;
            }
            threadInput = nextInput;
            threadOutput = nextOutput;
            input = threadInput - baselineInput;
            output = threadOutput - baselineOutput;
            usageKnown =
              !invalidUsage &&
              Number.isSafeInteger(input) &&
              input >= 0 &&
              Number.isSafeInteger(output) &&
              output >= 0;
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
          p.reject(
            new RuntimeFailure(code, accepted, usageKnown, input, output),
          );
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
            version: "0.2.0",
          },
          capabilities: { experimentalApi: true },
        });
        child.stdin.write(
          JSON.stringify({ method: "initialized", params: {} }) + "\n",
        );
        const common = {
          model: c.AI_MODEL,
          modelProvider: "copypaste_internal",
          cwd: ctx.workspace,
          approvalPolicy: "never",
          sandbox: "read-only",
          environments: [],
          developerInstructions:
            "You are a CopyPaste enterprise specialist. Use only the registered tools, bound Skills and current project data. No shell, arbitrary network, secrets, local virtualization, unsupported claims or fabricated artifacts. Deliver editable sources and report unresolved requirements.",
        };
        const result = await send(
          ctx.thread ? "thread/resume" : "thread/start",
          ctx.thread
            ? { ...common, threadId: ctx.thread, excludeTurns: true }
            : {
                ...common,
                allowProviderModelFallback: false,
                dynamicTools: ctx.tools.map(
                  ({ name, description, inputSchema }) => ({
                    name,
                    description,
                    inputSchema,
                  }),
                ),
              },
        );
        thread = result.thread.id;
        if (
          (ctx.thread && thread !== ctx.thread) ||
          result.model !== c.AI_MODEL ||
          result.modelProvider !== "copypaste_internal"
        )
          throw new RuntimeFailure("CODEX_PROFILE_MISMATCH", false, true);
        await ctx.onEvent("runtime.thread", { thread_id: thread });
        await saveReceipt({ state: "in_flight", thread, fingerprint });
        accepted = true; // A lost turn/start response is uncertain and must not release the reservation.
        const t = await send("turn/start", {
          threadId: thread,
          model: c.AI_MODEL,
          effort: c.AI_REASONING_EFFORT,
          input: [...skills, { type: "text", text: ctx.prompt }],
        });
        turn = t.turn.id;
        await ctx.onEvent("runtime.turn", { thread_id: thread, turn_id: turn });
        if (ctx.signal.aborted) abort();
        const status = await done;
        await ctx.onEvent("runtime.phase", { phase: "finished", status });
        await chain;
        if (gateway.forwardedRequests === 0) {
          // A local denial is proof that no provider request was dispatched.
          accepted = false;
          usageKnown = true;
          input = output = 0;
        }
        // A later local rejection does not make already measured spend unknown.
        // Both the native counters and every dispatched response must agree;
        // partial usage, a broken stream or a native regression stays unknown.
        const measured = gateway.measuredUsage;
        if (
          accepted &&
          status !== "completed" &&
          (!measured.allResponsesKnown ||
            measured.inputTokens !== input ||
            measured.outputTokens !== output)
        )
          usageKnown = false;
        if (["timeout", "process_exit", "process_error"].includes(status))
          throw new RuntimeFailure(
            "CODEX_CONNECTION_LOST",
            accepted,
            usageKnown,
            input,
            output,
          );
        completedResult = {
          text,
          inputTokens: input,
          outputTokens: output,
          usageKnown,
          accepted,
          thread,
          turn,
          status,
        };
        return completedResult;
      } catch (e) {
        if (e instanceof RuntimeFailure) {
          if (e.accepted) e.usageKnown = false;
          throw e;
        }
        throw new RuntimeFailure(
          "CODEX_RUNTIME_FAILED",
          accepted,
          accepted ? false : usageKnown,
          input,
          output,
        );
      } finally {
        await gateway.close();
        await ctx
          .onEvent("runtime.phase", { phase: "cleanup" })
          .catch(() => {});
        clearTimeout(deadline);
        if (interruptTimer) clearTimeout(interruptTimer);
        ctx.signal.removeEventListener("abort", abort);
        lines.close();
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("Runtime stopped"));
        }
        child.stdin.end();
        // EOF lets app-server close its databases normally. Windows can retain
        // inherited pipe handles after the process exits; do not treat those as
        // a running kernel, and explicitly close our own handles after exit.
        if (!(await waitForExit(250))) child.kill("SIGKILL");
        if (!(await waitForExit(10000)))
          throw new RuntimeFailure(
            "CODEX_CLEANUP_FAILED",
            accepted,
            usageKnown,
            input,
            output,
          );
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
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
        if (
          completedResult?.status === "completed" &&
          completedResult.usageKnown
        ) {
          try {
            await saveReceipt({
              state: "ready",
              thread,
              fingerprint,
              inputTokens: threadInput,
              outputTokens: threadOutput,
            });
          } catch {
            // Receipt I/O failure must retain measured spend, never appear to
            // the worker as an unaccepted/zero-cost initialization failure.
            throw new RuntimeFailure(
              "CODEX_CHECKPOINT_WRITE_FAILED",
              accepted,
              usageKnown,
              input,
              output,
            );
          }
        }
      }
    } finally {
      await gateway.close();
    }
  }
}
