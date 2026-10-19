import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import {
  CodexRuntimeAdapter,
  RuntimeFailure,
  type RuntimeContext,
} from "../src/runtime.js";

async function fixtureWorkspace() {
  const parent = path.resolve(".data/test/runtime");
  await mkdir(parent, { recursive: true });
  return { parent, root: await mkdtemp(path.join(parent, "turn-")) };
}

async function cleanupFixture(
  parent: string,
  root: string,
  t: { diagnostic(message: string): void },
) {
  if (path.dirname(root) !== parent) throw new Error("Unsafe test cleanup");
  try {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  } catch (error: any) {
    if (
      process.platform !== "win32" ||
      !["EBUSY", "EPERM", "EACCES"].includes(error.code)
    )
      throw error;
    // Codex has closed. Windows indexing/antivirus may retain a SQLite handle.
    // The ignored fixture is retained; unbounded recursive retries would hide the test result.
    t.diagnostic(
      `Windows retained a locked temporary fixture: ${path.basename(root)} (${error.code})`,
    );
  }
}

test(
  "real Codex persists and resumes a thread with restored tools, history, profile checks and incremental usage",
  { timeout: 120000 },
  async (t) => {
    const calls: { url: string; authorized: boolean; body: any }[] = [];
    const interrupt = new AbortController();
    const secret = randomBytes(32).toString("hex");
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      calls.push({
        url: req.url!,
        authorized: req.headers.authorization === "Bearer " + secret,
        body,
      });
      if (req.url !== "/v1/responses") {
        res.writeHead(404).end("{}");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const item = {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Protocol fixture delivered.",
            annotations: [],
          },
        ],
      };
      const response = {
        id: "resp_fixture",
        object: "response",
        model: "copypaste-contract-fixture",
        created_at: Math.floor(Date.now() / 1000),
        status: "in_progress",
        output: [] as any[],
      };
      const event = (type: string, data: any) =>
        res.write(
          "event: " +
            type +
            "\ndata: " +
            JSON.stringify({ type, ...data }) +
            "\n\n",
        );
      if (calls.length === 6) {
        event("response.created", { response });
        // Real native turn/interrupt, with a provider response still in flight.
        // No synthetic terminal usage is supplied for this accepted request.
        interrupt.abort();
        return;
      }
      if (calls.length % 2 === 1) {
        const fn = {
          id: "fc_fixture_" + calls.length,
          type: "function_call",
          name: "fixture_lookup",
          call_id: "call_fixture_" + calls.length,
          arguments: JSON.stringify({ dataset_id: "fixture" }),
        };
        event("response.created", { response });
        event("response.output_item.added", {
          output_index: 0,
          item: { ...fn, arguments: "" },
        });
        event("response.function_call_arguments.delta", {
          output_index: 0,
          item_id: fn.id,
          delta: fn.arguments,
        });
        event("response.function_call_arguments.done", {
          output_index: 0,
          item_id: fn.id,
          arguments: fn.arguments,
        });
        event("response.output_item.done", { output_index: 0, item: fn });
        event("response.completed", {
          response: {
            ...response,
            status: "completed",
            output: [fn],
            usage: {
              input_tokens: 17,
              output_tokens: 5,
              total_tokens: 22,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        });
        res.end();
        return;
      }
      event("response.created", { response });
      event("response.output_item.added", {
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      });
      event("response.content_part.added", {
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      event("response.output_text.delta", {
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: "Protocol fixture delivered.",
      });
      event("response.output_text.done", {
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        text: "Protocol fixture delivered.",
      });
      event("response.output_item.done", { output_index: 0, item });
      event("response.completed", {
        response: {
          ...response,
          status: "completed",
          output: [item],
          usage: {
            input_tokens: 17,
            output_tokens: 5,
            total_tokens: 22,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const { parent, root } = await fixtureWorkspace();
    const c = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: secret,
      AI_MODEL: "copypaste-contract-fixture",
      AI_VERIFIED: "true",
      AI_REASONING_EFFORT: "medium",
    });
    const events: any[] = [];
    let toolCalls = 0;
    try {
      const context: RuntimeContext = {
        taskId: "protocol-fixture",
        prompt: "Return the protocol fixture.",
        workspace: root,
        skills: [
          {
            key: "fixture-method",
            content:
              "---\nname: fixture-method\ndescription: Controlled protocol test method.\n---\nUse fixture_lookup to obtain the exact dataset value.",
          },
        ],
        signal: AbortSignal.any([AbortSignal.timeout(60000), t.signal]),
        onEvent: async (kind, body) => {
          events.push({ kind, body });
        },
        tools: [
          {
            name: "fixture_lookup",
            description: "Read the controlled fixture dataset.",
            inputSchema: {
              type: "object",
              properties: { dataset_id: { type: "string" } },
              required: ["dataset_id"],
              additionalProperties: false,
            },
            run: async (args) => {
              assert.deepEqual(args, { dataset_id: "fixture" });
              toolCalls++;
              return { fixture_value: 42 };
            },
          },
        ],
      };
      const result = await new CodexRuntimeAdapter(c).start(context);
      assert.equal(result.status, "completed");
      assert.match(result.text, /Protocol fixture delivered/);
      assert.equal(result.usageKnown, true);
      assert.equal(result.inputTokens, 34);
      assert.equal(result.outputTokens, 10);
      assert.equal(toolCalls, 1);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "/v1/responses");
      assert.equal(calls[0].authorized, true);
      assert.equal(calls[0].body.model, "copypaste-contract-fixture");
      assert.match(JSON.stringify(calls[0].body), /fixture_lookup/);
      assert.match(JSON.stringify(calls[1].body), /fixture_value/);
      const checkpointPath = path.join(
        root,
        ".codex",
        "copypaste-continuation.json",
      );
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
      assert.equal(checkpoint.state, "ready");
      assert.equal(checkpoint.thread, result.thread);
      assert.equal(checkpoint.inputTokens, 34);
      assert.equal(checkpoint.outputTokens, 10);
      const resume = {
        ...context,
        thread: result.thread,
        prompt:
          "Continue the prior discussion. Obtain the fixture once more using its registered tool.",
      };
      for (const invalid of [
        { ...resume, thread: "019b0000-0000-7000-8000-000000000001" },
        { ...resume, tools: [] },
        { ...resume, skills: [] },
      ])
        await assert.rejects(new CodexRuntimeAdapter(c).start(invalid), {
          code: "CODEX_CHECKPOINT_UNAVAILABLE",
        });
      await assert.rejects(new CodexRuntimeAdapter(c).start(context), {
        code: "CODEX_CONTINUATION_REQUIRED",
      });
      await assert.rejects(
        new CodexRuntimeAdapter({ ...c, AI_MODEL: "unapproved-model" }).start(
          resume,
        ),
        { code: "CODEX_CHECKPOINT_UNAVAILABLE" },
      );
      assert.equal(
        calls.length,
        2,
        "Invalid continuation must not call the provider",
      );
      // New adapter/process, same CODEX_HOME. No dynamicTools on thread/resume.
      const next = await new CodexRuntimeAdapter(c).start(resume);
      assert.equal(next.thread, result.thread);
      assert.notEqual(next.turn, result.turn);
      assert.equal(next.status, "completed");
      assert.equal(next.usageKnown, true);
      assert.equal(
        next.inputTokens,
        34,
        "Historical usage must not be charged again",
      );
      assert.equal(next.outputTokens, 10);
      assert.equal(toolCalls, 2, "Persisted dynamic tool remains executable");
      assert.equal(calls.length, 4);
      assert.match(JSON.stringify(calls[2].body), /Protocol fixture delivered/);
      assert.match(JSON.stringify(calls[2].body), /fixture_lookup/);
      const latest = JSON.parse(await readFile(checkpointPath, "utf8"));
      assert.equal(latest.inputTokens, 68);
      assert.equal(latest.outputTokens, 20);
      const interrupted = await new CodexRuntimeAdapter(c).start({
        ...resume,
        signal: AbortSignal.any([
          interrupt.signal,
          t.signal,
          AbortSignal.timeout(20000),
        ]),
      });
      assert.equal(interrupted.status, "interrupted");
      assert.equal(interrupted.accepted, true);
      assert.equal(interrupted.usageKnown, false);
      assert.equal(
        interrupted.inputTokens,
        17,
        "Earlier measured response remains available for reconciliation",
      );
      assert.equal(interrupted.outputTokens, 5);
      assert.equal(
        JSON.parse(await readFile(checkpointPath, "utf8")).state,
        "in_flight",
      );
      await assert.rejects(new CodexRuntimeAdapter(c).start(resume), {
        code: "CODEX_CHECKPOINT_UNAVAILABLE",
      });
      assert.equal(
        calls.length,
        6,
        "Unknown accepted work cannot resume automatically",
      );
      await writeFile(checkpointPath, "null");
      await assert.rejects(new CodexRuntimeAdapter(c).start(resume), {
        code: "CODEX_CHECKPOINT_INVALID",
      });
      const ioRoot = path.join(root, "receipt-io-probe");
      await assert.rejects(
        new CodexRuntimeAdapter(c).start({
          ...context,
          taskId: "receipt-io-probe",
          workspace: ioRoot,
          onEvent: async (kind, body) => {
            if (kind === "runtime.phase" && body.phase === "closed") {
              const receipt = path.join(
                ioRoot,
                ".codex",
                "copypaste-continuation.json",
              );
              await rm(receipt);
              await mkdir(receipt);
            }
          },
        }),
        (e: unknown) =>
          e instanceof RuntimeFailure &&
          e.code === "CODEX_CHECKPOINT_WRITE_FAILED" &&
          e.accepted &&
          e.usageKnown &&
          e.inputTokens === 34 &&
          e.outputTokens === 10,
      );
      assert.equal(
        calls.length,
        8,
        "The receipt fault occurs after actual paid responses, preserving measured usage",
      );
      const counterRoot = path.join(root, "counter-regression-probe"),
        counterContext = {
          ...context,
          taskId: "counter-regression-probe",
          workspace: counterRoot,
        },
        initial = await new CodexRuntimeAdapter(c).start(counterContext),
        counterPath = path.join(
          counterRoot,
          ".codex",
          "copypaste-continuation.json",
        ),
        baseline = JSON.parse(await readFile(counterPath, "utf8"));
      // A persisted baseline contradicting actual native counters must not
      // produce negative charges or a usable continuation receipt.
      await writeFile(
        counterPath,
        JSON.stringify({
          ...baseline,
          inputTokens: 99999,
          outputTokens: 99999,
        }),
      );
      const regressed = await new CodexRuntimeAdapter(c).start({
        ...counterContext,
        thread: initial.thread,
      });
      assert.equal(regressed.status, "completed");
      assert.equal(regressed.usageKnown, false);
      assert.equal(regressed.inputTokens, 0);
      assert.equal(regressed.outputTokens, 0);
      assert.equal(
        JSON.parse(await readFile(counterPath, "utf8")).state,
        "in_flight",
      );
      assert.equal(calls.length, 12);
    } catch (e: any) {
      throw new Error(
        `${e.code ?? e.message}; observed stages: ${events.map((e) => e.kind).join(",")}; fixture HTTP calls: ${calls.length}`,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await cleanupFixture(parent, root, t);
    }
  },
);

test(
  "cancelling an initializing real Codex process rejects the pending RPC and closes the child",
  { timeout: 20000 },
  async (t) => {
    const { parent, root } = await fixtureWorkspace();
    const controller = new AbortController();
    const events: string[] = [];
    const c = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      AI_BASE_URL: "http://127.0.0.1:1/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: randomBytes(32).toString("hex"),
      AI_MODEL: "copypaste-contract-fixture",
      AI_VERIFIED: "true",
    });
    let cancelledAt = 0;
    try {
      await assert.rejects(
        new CodexRuntimeAdapter(c).start({
          taskId: "cancel-fixture",
          prompt: "Must never reach the provider.",
          workspace: root,
          skills: [],
          tools: [],
          signal: AbortSignal.any([controller.signal, t.signal]),
          onEvent: async (kind, body) => {
            if (kind === "runtime.phase") {
              events.push(body.phase);
              if (body.phase === "initialize")
                queueMicrotask(() => {
                  cancelledAt = Date.now();
                  controller.abort();
                });
            }
          },
        }),
        (error: unknown) =>
          error instanceof RuntimeFailure &&
          error.code === "CODEX_CANCELLED" &&
          !error.accepted,
      );
      assert.ok(cancelledAt > 0);
      assert.ok(
        Date.now() - cancelledAt < 6000,
        "Cancellation must not wait for the 60-second RPC deadline",
      );
      assert.deepEqual(events, ["initialize", "cleanup", "closed"]);
    } finally {
      await cleanupFixture(parent, root, t);
    }
  },
);
